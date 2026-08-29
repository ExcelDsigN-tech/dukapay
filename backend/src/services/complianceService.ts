import crypto from 'node:crypto';
import { query } from '../db/connection.js';
import { AppError } from '../errors/AppError.js';
import logger from '../utils/logger.js';

export interface ApplicantScreeningInput {
  subjectId: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  countryCode: string;
}

interface ScreeningHit {
  types?: string[];
  match_status?: string;
}
interface ProviderSearchResponse {
  content?: { data?: { id?: string | number; hits?: ScreeningHit[]; results?: ScreeningHit[] } };
  data?: { id?: string | number; hits?: ScreeningHit[]; results?: ScreeningHit[] };
  id?: string | number;
  results?: ScreeningHit[];
}

const highRiskCountries = (): Set<string> =>
  new Set(
    (process.env.AML_HIGH_RISK_COUNTRIES ?? '')
      .split(',')
      .map((country) => country.trim().toUpperCase())
      .filter(Boolean),
  );

async function appendAudit(
  subjectId: string,
  eventType: string,
  decision: string,
  reasonCodes: string[],
  providerReference?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await query(
    `INSERT INTO compliance_audit_log
       (subject_id, event_type, decision, provider_reference, reason_codes, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)`,
    [
      subjectId,
      eventType,
      decision,
      providerReference ?? null,
      JSON.stringify(reasonCodes),
      JSON.stringify(metadata),
    ],
  );
}

async function providerRequest(
  path: string,
  body: Record<string, unknown>,
): Promise<ProviderSearchResponse> {
  const apiKey = process.env.COMPLYADVANTAGE_API_KEY;
  if (!apiKey) throw AppError.serviceUnavailable('Compliance screening is unavailable');
  const baseUrl = (
    process.env.COMPLYADVANTAGE_API_URL ?? 'https://api.complyadvantage.com'
  ).replace(/\/$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`provider_status_${response.status}`);
    return (await response.json()) as ProviderSearchResponse;
  } catch (error) {
    logger.withContext().error('Compliance provider request failed', {
      reason: error instanceof Error ? error.message : 'unknown',
    });
    throw AppError.serviceUnavailable('Compliance screening is unavailable');
  } finally {
    clearTimeout(timeout);
  }
}

export const complianceService = {
  async screenApplicant(input: ApplicantScreeningInput) {
    const response = await providerRequest('/searches', {
      search_term: { first_name: input.firstName, last_name: input.lastName },
      client_ref: input.subjectId,
      ...(process.env.COMPLYADVANTAGE_SEARCH_PROFILE
        ? { search_profile: process.env.COMPLYADVANTAGE_SEARCH_PROFILE }
        : {}),
      filters: {
        entity_type: 'person',
        country_codes: [input.countryCode.toUpperCase()],
        ...(input.dateOfBirth ? { birth_year: input.dateOfBirth.slice(0, 4) } : {}),
        types: ['sanction', 'warning', 'pep', 'adverse-media'],
      },
    });
    const data = response.content?.data ?? response.data;
    const hits = data?.hits ?? data?.results ?? response.results ?? [];
    const types = new Set(hits.flatMap((hit) => hit.types ?? []).map((type) => type.toLowerCase()));
    const sanctions = types.has('sanction') || types.has('warning');
    const pep = [...types].some((type) => type === 'pep' || type.startsWith('pep-class'));
    const adverseMedia = [...types].some((type) => type.startsWith('adverse-media'));
    const confirmedSanctions = hits.some(
      (hit) =>
        hit.match_status === 'true_positive' &&
        (hit.types?.includes('sanction') || hit.types?.includes('warning')),
    );
    const status = confirmedSanctions
      ? 'rejected'
      : sanctions || pep || adverseMedia
        ? 'review'
        : 'approved';
    const providerReference = String(data?.id ?? response.id ?? '');
    const reasonCodes = [
      sanctions && 'SANCTIONS_MATCH',
      pep && 'PEP_MATCH',
      adverseMedia && 'ADVERSE_MEDIA_MATCH',
    ].filter(Boolean) as string[];

    await query(
      `INSERT INTO compliance_profiles
         (subject_id, provider, provider_reference, status, country_code,
          sanctions_match, pep_match, adverse_media_match, screened_at, next_screening_at)
       VALUES ($1, 'complyadvantage', $2, $3, $4, $5, $6, $7, NOW(), NOW() + INTERVAL '30 days')
       ON CONFLICT (subject_id) DO UPDATE SET
         provider_reference = EXCLUDED.provider_reference, status = EXCLUDED.status,
         country_code = EXCLUDED.country_code, sanctions_match = EXCLUDED.sanctions_match,
         pep_match = EXCLUDED.pep_match, adverse_media_match = EXCLUDED.adverse_media_match,
         screened_at = NOW(), next_screening_at = NOW() + INTERVAL '30 days', updated_at = NOW()`,
      [
        input.subjectId,
        providerReference || null,
        status,
        input.countryCode.toUpperCase(),
        sanctions,
        pep,
        adverseMedia,
      ],
    );
    await appendAudit(
      input.subjectId,
      'ONBOARDING_SCREENING',
      status,
      reasonCodes,
      providerReference || undefined,
      { matchCount: hits.length },
    );
    return { status, sanctions, pep, adverseMedia, providerReference: providerReference || null };
  },

  async monitorTransaction(input: {
    subjectId: string;
    recipientAddress: string;
    amount: number;
    transactionReference: string;
  }) {
    if (process.env.KYC_ENFORCEMENT_ENABLED !== 'true')
      return { allowed: true, ruleCodes: [] as string[] };
    const profileResult = await query(
      'SELECT status, country_code FROM compliance_profiles WHERE subject_id = $1',
      [input.subjectId],
    );
    const profile = profileResult.rows[0];
    if (!profile || profile.status !== 'approved') {
      await appendAudit(input.subjectId, 'TRANSACTION_BLOCKED', 'blocked', ['KYC_NOT_APPROVED']);
      return { allowed: false, ruleCodes: ['KYC_NOT_APPROVED'] };
    }

    const history = await query(
      `SELECT COUNT(*)::int AS count_24h,
              COALESCE(SUM(amount), 0)::numeric AS amount_24h,
              COUNT(*) FILTER (WHERE amount >= $2 * 0.8 AND amount < $2)::int AS near_threshold_count
       FROM remittances WHERE sender_id = $1 AND created_at >= NOW() - INTERVAL '24 hours'`,
      [input.subjectId, Number(process.env.AML_REPORTING_THRESHOLD ?? 10_000)],
    );
    const row = history.rows[0] ?? {};
    const threshold = Number(process.env.AML_REPORTING_THRESHOLD ?? 10_000);
    const rules: string[] = [];
    if (Number(row.count_24h ?? 0) >= Number(process.env.AML_DAILY_TX_LIMIT ?? 10))
      rules.push('VELOCITY_24H');
    if (Number(row.amount_24h ?? 0) + input.amount >= threshold) rules.push('AGGREGATE_THRESHOLD');
    if (input.amount >= threshold) rules.push('LARGE_TRANSACTION');
    if (
      Number(row.near_threshold_count ?? 0) >= 2 &&
      input.amount >= threshold * 0.8 &&
      input.amount < threshold
    )
      rules.push('STRUCTURING');
    if (highRiskCountries().has(String(profile.country_code).toUpperCase()))
      rules.push('HIGH_RISK_JURISDICTION');
    if (rules.length === 0) return { allowed: true, ruleCodes: rules };

    const alertId = crypto.randomUUID();
    const sarId = crypto.randomUUID();
    const riskScore = Math.min(rules.length * 25, 100);
    await query(
      `INSERT INTO transaction_monitoring_alerts
         (id, subject_id, transaction_reference, risk_score, rule_codes)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [alertId, input.subjectId, input.transactionReference, riskScore, JSON.stringify(rules)],
    );
    const narrative = `Automated monitoring detected ${rules.join(', ')} for transaction ${input.transactionReference}. Compliance review required.`;
    await query(
      `INSERT INTO sar_reports (id, alert_id, subject_id, narrative)
       VALUES ($1, $2, $3, $4)`,
      [sarId, alertId, input.subjectId, narrative],
    );
    await appendAudit(input.subjectId, 'TRANSACTION_MONITORING', 'blocked', rules, undefined, {
      alertId,
      sarId,
      riskScore,
    });
    await this.submitSar(sarId, {
      alertId,
      subjectId: input.subjectId,
      narrative,
      ruleCodes: rules,
    });
    return { allowed: false, ruleCodes: rules, alertId, sarId };
  },

  async submitSar(sarId: string, report: Record<string, unknown>): Promise<void> {
    const url = process.env.SAR_FILING_API_URL;
    const token = process.env.SAR_FILING_API_TOKEN;
    if (!url || !token) return;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(report),
      });
      if (!response.ok) throw new Error(`filing_status_${response.status}`);
      const result = (await response.json()) as { id?: string };
      await query(
        "UPDATE sar_reports SET filing_status = 'submitted', provider_reference = $1, filed_at = NOW() WHERE id = $2",
        [result.id ?? null, sarId],
      );
    } catch (error) {
      logger.withContext().error('SAR provider submission failed', {
        sarId,
        reason: error instanceof Error ? error.message : 'unknown',
      });
    }
  },
};
