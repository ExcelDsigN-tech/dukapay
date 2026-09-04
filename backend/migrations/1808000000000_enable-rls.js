/**
 * Row-Level Security (RLS) — Issue #410 / #412
 *
 * Enables row-level security on every business table and installs policies that
 * map onto the four backend roles:
 *
 *   - borrower  — sees and manages only its own rows (tenant isolation)
 *   - agent     — additionally sees rows for borrowers explicitly assigned to it
 *                 via the `agent_assignments` join table
 *   - auditor   — read-only access to audit / compliance / KYC data
 *   - admin     — unrestricted access (all rows, all operations)
 *
 * Policy decisions are derived from the JWT claims the platform makes
 * available to Postgres through the `request.jwt.claims` GUC (Supabase) or the
 * `app.claims.*` GUCs (self-hosted deployments where the backend sets claims
 * explicitly). Ship the claim as JSON, e.g.:
 *
 *   SET LOCAL app.claims.wallet   = 'G...';
 *   SET LOCAL app.claims.role     = 'admin';
 *
 * or rely on Supabase's `request.jwt.claims`:
 *
 *   {"wallet": "G...", "role": "agent", "is_admin": false}
 *
 * IMPORTANT — self-hosted deployments where the application DB user owns the
 * tables keep working unchanged: table owners bypass RLS unless
 * `ALTER TABLE ... FORCE ROW LEVEL SECURITY` is applied, and this migration
 * deliberately does NOT force RLS. RLS is the enforcement layer for Supabase /
 * direct-database clients, while the backend's RBAC middleware
 * (`backend/src/middleware/rbac.ts`) is the equivalent enforcement for the API
 * surface. This mirrors Supabase's own model where the `service_role` key
 * (used by the backend) bypasses RLS and `anon`/`authenticated` clients are
 * subject to policies.
 */

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const up = (pgm) => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Claim-resolution helper functions (public schema so every role's
  //    search_path can resolve them without GRANT gymnastics).
  // ─────────────────────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE OR REPLACE FUNCTION public.dukapay_request_claim(claim_name text)
    RETURNS text
    LANGUAGE plpgsql
    STABLE
    AS $$
    DECLARE
      app_setting text;
      jwt_setting text;
    BEGIN
      app_setting := NULLIF(current_setting('app.claims.' || claim_name, true), '');
      IF app_setting IS NOT NULL THEN
        RETURN app_setting;
      END IF;

      jwt_setting := NULLIF(current_setting('request.jwt.claims', true), '');
      IF jwt_setting IS NOT NULL THEN
        BEGIN
          RETURN NULLIF((jwt_setting::jsonb) ->> claim_name, '');
        EXCEPTION WHEN OTHERS THEN
          RETURN NULL;
        END;
      END IF;

      RETURN NULL;
    END;
    $$;

    CREATE OR REPLACE FUNCTION public.dukapay_request_wallet()
    RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT public.dukapay_request_claim('wallet') $$;

    CREATE OR REPLACE FUNCTION public.dukapay_request_role()
    RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT public.dukapay_request_claim('role') $$;

    CREATE OR REPLACE FUNCTION public.dukapay_request_is_admin()
    RETURNS boolean LANGUAGE sql STABLE
    AS $$
      SELECT public.dukapay_request_claim('role') = 'admin'
          OR public.dukapay_request_claim('is_admin') = 'true'
    $$;

    CREATE OR REPLACE FUNCTION public.dukapay_request_is_agent()
    RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT public.dukapay_request_claim('role') = 'agent' $$;

    CREATE OR REPLACE FUNCTION public.dukapay_request_is_auditor()
    RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT public.dukapay_request_claim('role') = 'auditor' $$;
  `);

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Agent -> borrower assignment table. This is the tenant-scope primitive
  //    that lets an agent see only the borrowers explicitly assigned to it.
  // ─────────────────────────────────────────────────────────────────────────
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS public.agent_assignments (
      id serial PRIMARY KEY,
      agent_public_key varchar(255) NOT NULL,
      borrower_public_key varchar(255) NOT NULL,
      created_by varchar(255),
      created_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT agent_assignments_unique UNIQUE (agent_public_key, borrower_public_key)
    );
  `);
  pgm.createIndex('agent_assignments', ['borrower_public_key'], {
    name: 'idx_agent_assignments_borrower',
  });
  pgm.createIndex('agent_assignments', ['agent_public_key'], {
    name: 'idx_agent_assignments_agent',
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Policies.
  // ─────────────────────────────────────────────────────────────────────────
  const WALLET = 'public.dukapay_request_wallet()';

  // All tables that carry a wallet/owner column. `ownAll: true` additionally
  // grants INSERT/UPDATE/DELETE to the owner (borrowers manage their own
  // records); otherwise owners get read-only access to their own rows.
  const OWNED_TABLES = [
    { table: 'scores', owner: 'borrower', agentView: true, ownAll: false },
    { table: 'remittance_history', owner: 'user_id', agentView: true, ownAll: true },
    {
      table: 'remittances',
      owner: 'sender_id',
      related: 'recipient_address',
      agentView: true,
      ownAll: true,
    },
    { table: 'loan_history', owner: 'borrower_public_key', agentView: true, ownAll: false },
    { table: 'contract_events', owner: 'address', agentView: true, ownAll: false },
    { table: 'notifications', owner: 'user_id', agentView: false, ownAll: true },
    { table: 'user_profiles', owner: 'public_key', agentView: true, ownAll: true },
    { table: 'user_notification_preferences', owner: 'user_id', agentView: false, ownAll: true },
    { table: 'transaction_submissions', owner: 'submitted_by', agentView: false, ownAll: false },
    { table: 'dsar_requests', owner: 'public_key', agentView: false, ownAll: true },
    { table: 'compliance_profiles', owner: 'subject_id', agentView: false, ownAll: false },
    {
      table: 'transaction_monitoring_alerts',
      owner: 'subject_id',
      agentView: false,
      ownAll: false,
    },
    { table: 'cross_contract_reconciliation', owner: 'borrower', agentView: true, ownAll: false },
    // Legacy `loans` table (pre-event-sourcing) and the agent vault ledger are
    // not created by these migrations — add them defensively so RLS covers them
    // wherever they exist.
    { table: 'loans', owner: 'borrower', agentView: true, ownAll: false },
    { table: 'agent_vaults', owner: 'agent_address', agentView: false, ownAll: false },
    // Loan disputes carry a borrower owner and are created by the borrower.
    { table: 'loan_disputes', owner: 'borrower', agentView: true, ownAll: true },
  ];

  // Sensitive audit/compliance tables where a data-subject may read its own
  // rollup but never modify anything (many are append-only via triggers).
  const SUBJECT_TABLES = [
    { table: 'compliance_audit_log', owner: 'subject_id' },
    { table: 'sar_reports', owner: 'subject_id' },
    { table: 'pii_access_log', owner: 'actor' },
  ];

  // Internal/system tables with no per-user row; admins manage, auditors read.
  const INTERNAL_TABLES = [
    'audit_logs',
    'audit_epochs',
    'audit_merkle_leaves',
    'quarantine_events',
    'indexed_events',
    'indexer_state',
    'ledger_checkpoints',
    'webhook_subscriptions',
    'webhook_deliveries',
    'pause_state',
  ];

  const allTables = [
    ...OWNED_TABLES.map((t) => t.table),
    ...SUBJECT_TABLES.map((t) => t.table),
    ...INTERNAL_TABLES,
    'agent_assignments',
  ];

  const ALL_TABLES_TXT = allTables.map((t) => `'${t}'`).join(', ');

  // Enable RLS on every table (idempotent; fails safely if a table is gone).
  pgm.sql(`
    DO $$
    DECLARE
      t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY[${ALL_TABLES_TXT}] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        END IF;
      END LOOP;
    END $$;
  `);

  // Admin policy on every table: full access for admins.
  pgm.sql(`
    DO $$
    DECLARE
      t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY[${ALL_TABLES_TXT}] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR ALL USING (public.dukapay_request_is_admin()) WITH CHECK (public.dukapay_request_is_admin())',
            t || '_rls_admin', t
          );
        END IF;
      END LOOP;
    END $$;
  `);

  // Own-data policies for owner-bearing tables.
  pgm.sql(`
    DO $$
    DECLARE
      table_name text;
      owner_col text;
      related_col text;
      is_agent_view boolean;
      own_all boolean;
      own_expr text;
      agent_expr text;
      c record;
    BEGIN
      FOR c IN VALUES
        ('scores', 'borrower', NULL, false::boolean, false::boolean),
        ('remittance_history', 'user_id', NULL, true::boolean, true::boolean),
        ('remittances', 'sender_id', 'recipient_address', true::boolean, true::boolean),
        ('loan_history', 'borrower_public_key', NULL, true::boolean, false::boolean),
        ('contract_events', 'address', NULL, true::boolean, false::boolean),
        ('notifications', 'user_id', NULL, false::boolean, true::boolean),
        ('user_profiles', 'public_key', NULL, true::boolean, true::boolean),
        ('user_notification_preferences', 'user_id', NULL, false::boolean, true::boolean),
        ('transaction_submissions', 'submitted_by', NULL, false::boolean, false::boolean),
        ('dsar_requests', 'public_key', NULL, false::boolean, true::boolean),
        ('compliance_profiles', 'subject_id', NULL, false::boolean, false::boolean),
        ('transaction_monitoring_alerts', 'subject_id', NULL, false::boolean, false::boolean),
        ('cross_contract_reconciliation', 'borrower', NULL, true::boolean, false::boolean),
        ('loans', 'borrower', NULL, true::boolean, false::boolean),
        ('agent_vaults', 'agent_address', NULL, false::boolean, false::boolean),
        ('loan_disputes', 'borrower', NULL, true::boolean, true::boolean)
      LOOP
        table_name := c.column1;
        owner_col := quote_ident(c.column2);
        related_col := NULLIF(c.column3, '');
        is_agent_view := c.column4;
        own_all := c.column5;
        own_expr := owner_col || ' = public.dukapay_request_wallet()';
        IF related_col IS NOT NULL THEN
          own_expr := '(' || own_expr || ' OR ' || related_col || ' = public.dukapay_request_wallet()' || ')';
        END IF;

        IF to_regclass('public.' || table_name) IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = table_name
                         AND column_name = c.column2) THEN
          IF own_all THEN
            EXECUTE format(
              'CREATE POLICY %I ON public.%I FOR ALL USING (%s) WITH CHECK (%s)',
              table_name || '_rls_own', table_name, own_expr, own_expr
            );
          ELSE
            EXECUTE format(
              'CREATE POLICY %I ON public.%I FOR SELECT USING (%s)',
              table_name || '_rls_own_read', table_name, own_expr
            );
          END IF;

          IF is_agent_view THEN
            IF related_col IS NOT NULL THEN
              agent_expr := '(a.borrower_public_key = ' || quote_ident(table_name) || '.' || owner_col
                || ' OR a.borrower_public_key = ' || quote_ident(table_name) || '.' || related_col || ')';
            ELSE
              agent_expr := 'a.borrower_public_key = ' || quote_ident(table_name) || '.' || owner_col;
            END IF;

            EXECUTE format(
              'CREATE POLICY %I ON public.%I FOR SELECT USING (public.dukapay_request_is_agent() AND EXISTS (SELECT 1 FROM public.agent_assignments a WHERE a.agent_public_key = public.dukapay_request_wallet() AND %s))',
              table_name || '_rls_agent_assigned', table_name, agent_expr
            );
          END IF;
        END IF;
      END LOOP;
    END $$;
  `);

  // Subject read-own + auditor read-only for sensitive tables.
  pgm.sql(`
    DO $$
    DECLARE
      table_name text;
      owner_col text;
    BEGIN
      FOR c IN VALUES
        ('compliance_audit_log', 'subject_id'),
        ('sar_reports', 'subject_id'),
        ('pii_access_log', 'actor')
      LOOP
        table_name := c.column1;
        owner_col := quote_ident(c.column2);
        IF to_regclass('public.' || table_name) IS NOT NULL
           AND EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = table_name AND column_name = c.column2) Then
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT USING ((%s = public.dukapay_request_wallet()) OR public.dukapay_request_is_auditor())',
            table_name || '_rls_subject_own', table_name, owner_col
          );
        END IF;
      END LOOP;
    END $$;
  `);

  // Auditor read-only on internal/system tables.
  pgm.sql(`
    DO $$
    DECLARE
      t text;
    BEGIN
      FOREACH t IN ARRAY ARRAY[${ALL_TABLES_TXT}] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I FOR SELECT USING (public.dukapay_request_is_auditor())',
            t || '_rls_auditor_read', t
          );
        END IF;
      END LOOP;
    END $$;
  `);

  // Agent may inspect its own assignment rows.
  pgm.sql(`
    CREATE POLICY agent_assignments_rls_agent_own
      ON public.agent_assignments
      FOR SELECT
      USING (agent_public_key = public.dukapay_request_wallet());
  `);
};

/** @param pgm {import('node-pg-migrate').MigrationBuilder} */
export const down = (pgm) => {
  const OWNED = [
    'scores',
    'remittance_history',
    'remittances',
    'loan_history',
    'contract_events',
    'notifications',
    'user_profiles',
    'user_notification_preferences',
    'transaction_submissions',
    'dsar_requests',
    'compliance_profiles',
    'transaction_monitoring_alerts',
    'cross_contract_reconciliation',
    'loans',
    'agent_vaults',
    'loan_disputes',
    'compliance_audit_log',
    'sar_reports',
    'pii_access_log',
    'audit_logs',
    'audit_epochs',
    'audit_merkle_leaves',
    'quarantine_events',
    'indexed_events',
    'indexer_state',
    'ledger_checkpoints',
    'webhook_subscriptions',
    'webhook_deliveries',
    'pause_state',
    'agent_assignments',
  ];

  const ALL_TABLES_TXT = OWNED.map((t) => `'${t}'`).join(', ');

  // Drop every policy and disable RLS (idempotent; tables may be missing).
  pgm.sql(`
    DO $$
    DECLARE
      t text;
      pol text;
    BEGIN
      FOREACH t IN ARRAY ARRAY[${ALL_TABLES_TXT}] LOOP
        IF to_regclass('public.' || t) IS NOT NULL THEN
          FOR pol IN
            SELECT policyname FROM pg_policy WHERE polrelid = format('public.%I', t)::regclass
          LOOP
            EXECUTE format('DROP POLICY %I ON public.%I', pol, t);
          END LOOP;
          EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
        END IF;
      END LOOP;
    END $$;
  `);

  pgm.dropTable('agent_assignments', { ifExists: true });

  pgm.sql(`
    DROP FUNCTION IF EXISTS public.dukapay_request_claim(text);
    DROP FUNCTION IF EXISTS public.dukapay_request_wallet();
    DROP FUNCTION IF EXISTS public.dukapay_request_role();
    DROP FUNCTION IF EXISTS public.dukapay_request_is_admin();
    DROP FUNCTION IF EXISTS public.dukapay_request_is_agent();
    DROP FUNCTION IF EXISTS public.dukapay_request_is_auditor();
  `);
};