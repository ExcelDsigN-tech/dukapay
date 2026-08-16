import fs from 'fs';
import path from 'path';
import os from 'os';

const BACKEND_PATH = path.resolve(process.cwd(), 'backend/src/errors/errorCodes.ts');
const FRONTEND_PATH = path.resolve(process.cwd(), 'frontend/src/app/utils/transactionErrors.ts');

/**
 * Verify that every key in the backend ErrorCode enum has a corresponding
 * identifier in the frontend transactionErrors module.
 *
 * Returns `{ ok, missing }` where `missing` lists ErrorCode keys that do not
 * appear in the frontend file.
 */
function checkMappings(backendPath, frontendPath) {
  const backendContent = fs.readFileSync(backendPath, 'utf8');
  const frontendContent = fs.readFileSync(frontendPath, 'utf8');

  // Extract enum keys from `export enum ErrorCode { ... }`
  const enumMatch = backendContent.match(/export\s+enum\s+ErrorCode\s*\{([\s\S]*?)\}/);

  if (!enumMatch) {
    throw new Error(`Could not parse ErrorCode enum in ${backendPath}`);
  }

  const enumBody = enumMatch[1];
  const errorCodeKeys = [];
  const keyRegex = /^\s*([A-Z0-9_]+)\s*=/gm;
  let match;

  while ((match = keyRegex.exec(enumBody)) !== null) {
    errorCodeKeys.push(match[1]);
  }

  // Verify each ErrorCode exists in frontend ERROR_CODE_MESSAGES or transactionErrors mapping
  const missingCodes = [];

  for (const code of errorCodeKeys) {
    const codePattern = new RegExp(`\\b${code}\\b`);
    if (!codePattern.test(frontendContent)) {
      missingCodes.push(code);
    }
  }

  return { ok: missingCodes.length === 0, missing: missingCodes, total: errorCodeKeys.length };
}

/**
 * Self-test: run checkMappings against throwaway fixtures to prove the check
 * passes when mappings are complete and fails when one is missing.
 */
function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-error-code-'));
  const backendFixture = path.join(dir, 'errorCodes.ts');
  const frontendFixture = path.join(dir, 'transactionErrors.ts');

  const backendOk = `export enum ErrorCode {\n  A = 'A',\n  B = 'B',\n}\n`;
  const frontendOk = `export const ERROR_CODE_MESSAGES = {\n  A: 'a',\n  B: 'b',\n};\n`;
  const frontendMissing = `export const ERROR_CODE_MESSAGES = {\n  A: 'a',\n};\n`;

  let failures = 0;

  try {
    fs.writeFileSync(backendFixture, backendOk);
    fs.writeFileSync(frontendFixture, frontendOk);
    const pass = checkMappings(backendFixture, frontendFixture);
    if (!pass.ok || pass.missing.length > 0) {
      console.error(`::error::self-test failed: expected PASS, got missing=[${pass.missing}]`);
      failures++;
    } else {
      console.log(`self-test: complete mappings -> PASS (${pass.total} codes)`);
    }
  } catch (err) {
    console.error(`::error::self-test failed (positive case threw): ${err.message}`);
    failures++;
  }

  try {
    fs.writeFileSync(frontendFixture, frontendMissing);
    const fail = checkMappings(backendFixture, frontendFixture);
    if (fail.ok) {
      console.error('::error::self-test failed: expected FAIL for missing mapping, got PASS');
      failures++;
    } else if (!fail.missing.includes('B')) {
      console.error(`::error::self-test failed: expected 'B' to be reported missing, got [${fail.missing}]`);
      failures++;
    } else {
      console.log(`self-test: missing mapping -> correctly reported [${fail.missing.join(', ')}]`);
    }
  } catch (err) {
    console.error(`::error::self-test failed (negative case threw): ${err.message}`);
    failures++;
  }

  fs.rmSync(dir, { recursive: true, force: true });

  if (failures > 0) {
    console.error('::error::check-error-code-mappings self-test FAILED');
    process.exit(1);
  }
  console.log('✅ Self-test passed: check logic behaves as expected.');
}

const isSelfTest = process.argv.includes('--self-test');

if (isSelfTest) {
  selfTest();
} else {
  if (!fs.existsSync(BACKEND_PATH)) {
    console.error(`::error::Backend ErrorCode definition file not found at ${BACKEND_PATH}`);
    process.exit(1);
  }

  if (!fs.existsSync(FRONTEND_PATH)) {
    console.error(`::error::Frontend transactionErrors file not found at ${FRONTEND_PATH}`);
    process.exit(1);
  }

  let result;
  try {
    result = checkMappings(BACKEND_PATH, FRONTEND_PATH);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(1);
  }

  console.log(`Found ${result.total} backend ErrorCode definitions.`);

  if (!result.ok) {
    console.error(`::error::CI GUARD FAILURE: The following backend ErrorCode(s) lack frontend message mappings in frontend/src/app/utils/transactionErrors.ts:`);
    for (const missing of result.missing) {
      console.error(`  - ${missing}`);
    }
    process.exit(1);
  }

  console.log('✅ Success: All backend ErrorCode definitions have corresponding frontend message mappings!');
  process.exit(0);
}