/**
 * Bundle-size budget gate (issue #443).
 *
 * Runs after `next build`. Walks the emitted production chunks and fails the
 * CI job if any app JS bundle exceeds MAX_CHUNK_KB gzipped or the total JS
 * payload exceeds MAX_TOTAL_KB gzipped. Shared runtimes are exempt so a single
 * vendor fatigue/framework dark-ship can't mask app-side growth (they still
 * count toward the total).
 */
import { readdir, stat, readFile } from 'node:fs/promises';
import { createGzip } from 'node:zlib';
import { promisify } from 'node:util';
import path from 'node:path';

const gzip = promisify(createGzip);
const MAX_CHUNK_KB = 200; // per-chunk gzipped (issue budget: JS < 200KB gz)
const MAX_TOTAL_KB = 1800; // total app JS gzipped
const BUILD_DIR = path.resolve(process.cwd(), '.next', 'static', 'chunks');

async function gzSizeOf(file) {
  const buf = await readFile(file);
  const gz = await gzip(buf);
  return gz.length;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

async function main() {
  let files;
  try {
    files = await walk(BUILD_DIR);
  } catch (err) {
    console.error(`bundle check: build output not found at ${BUILD_DIR} — run npm run build first`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error('bundle check: no JS chunks found in build output');
    process.exit(1);
  }

  const entries = [];
  let total = 0;
  for (const file of files) {
    const sizeKb = (await gzSizeOf(file)) / 1024;
    total += sizeKb;
    entries.push({ name: path.relative(process.cwd(), file), sizeKb });
  }

  for (const e of entries) {
    console.log(`${e.sizeKb.toFixed(1).padStart(7)} KB gz  ${e.name}`);
  }
  console.log(`\nTotal app JS: ${total.toFixed(1)} KB gz (budget ${MAX_TOTAL_KB} KB)`);

  const overBudget = entries.filter((e) => e.sizeKb > MAX_CHUNK_KB);
  const totalOver = total > MAX_TOTAL_KB;

  if (overBudget.length || totalOver) {
    console.error('\n❌ Performance budget exceeded (issue #443):');
    for (const e of overBudget) {
      console.error(`  - ${e.name}: ${e.sizeKb.toFixed(1)} KB > ${MAX_CHUNK_KB} KB`);
    }
    if (totalOver) console.error(`  - total ${total.toFixed(1)} KB > ${MAX_TOTAL_KB} KB`);
    process.exit(1);
  }

  console.log('✅ Bundle-size budget OK.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});