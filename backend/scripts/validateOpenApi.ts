import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import SwaggerParser from 'swagger-parser';
import type { OpenAPIV3 } from 'openapi-types';

import { swaggerSpec } from '../src/config/swagger.js';

// Pure type-only + value imports of routers (mirrors src/app.ts mounts).
import type { Router } from 'express';
import simulationRoutes from '../src/routes/simulationRoutes.js';
import scoreRoutes from '../src/routes/scoreRoutes.js';
import loanRoutes from '../src/routes/loanRoutes.js';
import poolRoutes from '../src/routes/poolRoutes.js';
import indexerRoutes from '../src/routes/indexerRoutes.js';
import adminRoutes from '../src/routes/adminRoutes.js';
import authRoutes from '../src/routes/authRoutes.js';
import userRoutes from '../src/routes/userRoutes.js';
import notificationsRoutes from '../src/routes/notificationsRoutes.js';
import eventRoutes from '../src/routes/eventRoutes.js';
import remittanceRoutes from '../src/routes/remittanceRoutes.js';
import transactionRoutes from '../src/routes/transactionRoutes.js';
import privacyRoutes from '../src/routes/privacyRoutes.js';
import auditRoutes from '../src/routes/auditRoutes.js';
import agentRoutes from '../src/routes/agentRoutes.js';

export const OPENAPI_ARTIFACT = 'openapi.json';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../src/swagger', OPENAPI_ARTIFACT);

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'] as const;

/**
 * Mount table mirroring src/app.ts. The key is the spec-relative base path
 * (the express mount prefix with `/api`/`/api/v1` stripped); each entry maps
 * to the router instance registered there.
 */
const MOUNTS: Array<[specBasePath: string, router: Router]> = [
  ['', simulationRoutes],
  ['/score', scoreRoutes],
  ['/loans', loanRoutes],
  ['/pool', poolRoutes],
  ['/indexer', indexerRoutes],
  ['/admin', adminRoutes],
  ['/auth', authRoutes],
  ['/remittances', remittanceRoutes],
  ['/transactions', transactionRoutes],
  ['/notifications', notificationsRoutes],
  ['/events', eventRoutes],
  ['/privacy', privacyRoutes],
  ['/audit', auditRoutes],
  ['/user', userRoutes],
  ['/agents', agentRoutes],
];

interface LayerLike {
  route?: {
    path?: string | string[];
    stack?: LayerLike[];
  };
  name?: string;
  handle?: { stack?: LayerLike[] };
}

/**
 * Validate the compiled OpenAPI document with swagger-parser. Throws when the
 * document is structurally invalid (broken refs, malformed schemas, duplicate
 * operationIds, …). This is the authoritative schema-correctness gate.
 */
export async function validateSpec(spec: unknown): Promise<void> {
  // Validate against a deep clone so swagger-parser's in-place `$ref`
  // dereferencing never mutates the shared `swaggerSpec` singleton (which the
  // artifact drift check and `openapi:generate` rely on to stay stable).
  const clone = structuredClone(spec) as Parameters<typeof SwaggerParser.validate>[0];
  try {
    await SwaggerParser.validate(clone);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenAPI validation failed: ${message}`);
  }
}

/** Convert an Express `:param` path segment to the OpenAPI `{param}` form. */
function toOpenApiPath(expressPath: string): string {
  const normalized = expressPath
    .split('/')
    .map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment))
    .join('/')
    .replace(/\/+$/, '');
  return normalized || '/';
}

/** Return `METHOD specPath` entries for a single Express route layer. */
function routeMethods(layer: LayerLike, base: string): string[] {
  const path = layer.route?.path;
  if (typeof path !== 'string') return [];
  const full = toOpenApiPath(base + path);
  const methods = (layer.route?.stack ?? [])
    .map((r) => r.method)
    .filter((m): m is string => typeof m === 'string' && HTTP_METHODS.includes(m as never));
  return [...new Set(methods)].map((m) => `${m.toUpperCase()} ${full}`);
}

/** Enumerate every canonical public-API endpoint the code registers. */
function registeredEndpoints(): Set<string> {
  const acc = new Set<string>();
  for (const [base, router] of MOUNTS) {
    const stack = (router as unknown as { stack?: LayerLike[] }).stack;
    if (!stack) continue;
    for (const layer of stack) {
      if (layer.route && typeof layer.route.path === 'string') {
        for (const entry of routeMethods(layer, base)) acc.add(entry);
      }
    }
  }
  return acc;
}

/** Public production API endpoints that are intentionally absent from the
 * OpenAPI spec because they are registered conditionally for non-production
 * environments only (test/development test-seeding helpers). They are not part
 * of the production API contract (Issue #437). */
const ENV_GATED_ROUTES = new Set<string>([
  'POST /loans',
  'POST /loans/{loanId}/mark-defaulted',
  'POST /auth/register',
]);

/** Determine which registered endpoints are absent from the OpenAPI spec. */
function findUndocumented(
  registered: Set<string>,
  spec: OpenAPIV3.Document,
): Array<{ route: string; path: string; method: string }> {
  const missing: Array<{ route: string; path: string; method: string }> = [];
  for (const entry of registered) {
    if (ENV_GATED_ROUTES.has(entry)) continue;
    const idx = entry.indexOf(' ');
    const method = entry.slice(0, idx).toLowerCase();
    const path = entry.slice(idx + 1);
    const specOp = (spec.paths?.[path] as OpenAPIV3.OperationObject | undefined)?.[
      method as keyof OpenAPIV3.PathItemObject
    ];
    if (!specOp) missing.push({ route: entry, path, method });
  }
  return missing;
}

async function main(): Promise<void> {
  const ok = <T>(label: string, fn: () => T): T => {
    const value = fn();
    console.log(`  ✓ ${label}`);
    return value;
  };

  console.log('Validating DukaPay OpenAPI spec…');

  // 1. Structural validation via swagger-parser.
  ok('swagger-parser schema/ref validation', () => validateSpec(swaggerSpec));

  // 2. Route coverage: every registered public-API endpoint must be documented.
  const spec = swaggerSpec as unknown as OpenAPIV3.Document;
  const registered = ok('enumerating registered API endpoints', () => registeredEndpoints());
  const missing = ok('cross-checking endpoints against spec', () =>
    findUndocumented(registered, spec),
  );

  const pathCount = Object.keys(spec.paths ?? {}).length;
  const operationCount = Object.values(spec.paths ?? {}).reduce(
    (acc, item) => acc + Object.values(item ?? {}).filter((o) => o && typeof o === 'object').length,
    0,
  );

  console.log(`\n  Registered endpoints : ${registered.size}`);
  console.log(`  Documented paths     : ${pathCount}`);
  console.log(`  Documented operations: ${operationCount}`);
  console.log(`  Undocumented routes  : ${missing.length}`);
  for (const { route } of missing) {
    console.log(`    - ${route}`);
  }

  // 3. Generated artifact drift check.
  const artifactMatches = ok('checking committed openapi.json artifact', () => {
    if (!existsSync(outPath)) return false;
    const committed = readFileSync(outPath, 'utf8');
    return committed.trim() === (JSON.stringify(spec, null, 2) + '\n').trim();
  });

  const failures: string[] = [];
  if (missing.length > 0) {
    failures.push(
      `Found ${missing.length} registered route(s) missing from the OpenAPI spec. ` +
        'Add @swagger documentation for each, then run `npm run openapi:generate`.',
    );
  }
  if (!artifactMatches) {
    failures.push(
      `${OPENAPI_ARTIFACT} is out of date. Run \`npm run openapi:generate\` and commit the result.`,
    );
  }

  if (failures.length > 0) {
    console.error('\n✖ OpenAPI validation failed:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    process.exit(1);
  }

  console.log('\n✔ OpenAPI spec matches implementation and is up to date.');
}

const isDirectRun = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  main().catch((error) => {
    console.error('\n✖ OpenAPI validation failed:');
    console.error(`  - ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
