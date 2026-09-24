import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import SwaggerParser from 'swagger-parser';
import { swaggerSpec } from '../src/config/swagger.js';
import { OPENAPI_ARTIFACT, validateSpec } from './validateOpenApi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../src/swagger', OPENAPI_ARTIFACT);

// Guarantee the emitted spec is valid before we ever persist it.
await validateSpec(swaggerSpec);

const serialized = JSON.stringify(swaggerSpec, null, 2) + '\n';
const inCheckMode = process.argv.includes('--check');

let changed = !existsSync(outPath);
if (existsSync(outPath)) {
  const existing = readFileSync(outPath, 'utf8');
  changed = existing.trim() !== serialized.trim();
}

if (inCheckMode) {
  if (changed) {
    console.error(
      `OpenAPI drift detected: ${outPath} is out of date with the code. ` +
        'Run `npm run openapi:generate` and commit the regenerated spec.',
    );
    process.exit(1);
  }
  console.log(`OpenAPI spec artifact is up to date: ${OPENAPI_ARTIFACT}`);
  process.exit(0);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, serialized);
console.log(
  `Generated ${OPENAPI_ARTIFACT}: ` +
    `${Object.keys(swaggerSpec.paths ?? {}).length} paths, ` +
    `${Object.values(swaggerSpec.paths ?? {}).reduce(
      (acc, ops) =>
        acc +
        Object.keys(ops ?? {}).filter((m) =>
          ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(m),
        ).length,
      0,
    )} operations.`,
);
