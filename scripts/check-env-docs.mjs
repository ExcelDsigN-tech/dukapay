#!/usr/bin/env node

/**
 * check-env-docs.mjs
 *
 * Compares keys found in backend/.env.example and frontend/.env.example
 * against the tables listed in docs/ENVIRONMENT.md.
 *
 * Exits with code 1 if any key is missing from either side.
 *
 * Usage:
 *   node scripts/check-env-docs.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function parseEnvKeys(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const keys = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    keys.push(trimmed.slice(0, eqIdx).trim());
  }
  return keys;
}

function parseDocKeysInSection(content, sectionTitle) {
  const lines = content.split("\n");
  const sectionStart = lines.findIndex((l) => l.startsWith(sectionTitle));
  if (sectionStart === -1) return null;

  const keys = [];
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("## ") || line.startsWith("---") && i > sectionStart + 1) break;
    const match = line.match(/^\|\s*`([A-Z_][A-Z0-9_]*)`\s*\|/);
    if (match) keys.push(match[1]);
  }
  return keys;
}

const docPath = join(root, "docs", "ENVIRONMENT.md");
const docContent = readFileSync(docPath, "utf-8");

const envFiles = [
  { path: join(root, "backend", ".env.example"), label: "backend/.env.example", section: "## Backend (" },
  { path: join(root, "frontend", ".env.example"), label: "frontend/.env.example", section: "## Frontend (" },
  { path: join(root, "scripts", ".env.example"), label: "scripts/.env.example", section: "## Contracts / Scripts (" },
];

// DEMO_MODE is documented in its own "## Demo Mode" section but is a backend
// variable. Fold it into the backend section's expected key set.
const demoModeSection = parseDocKeysInSection(docContent, "## Demo Mode") ?? [];

let exitCode = 0;

for (const { path, label, section } of envFiles) {
  const docKeys = parseDocKeysInSection(docContent, section);
  if (docKeys === null) {
    console.error(`\n❌ docs/ENVIRONMENT.md is missing the section starting '${section}'`);
    exitCode = 1;
    continue;
  }

  const expected = section.startsWith("## Backend")
    ? new Set([...docKeys, ...demoModeSection])
    : new Set(docKeys);

  const envKeys = parseEnvKeys(path);
  const missingInDoc = envKeys.filter((k) => !expected.has(k));
  const unexpected = [...expected].filter((k) => !envKeys.includes(k));

  if (missingInDoc.length > 0) {
    console.error(`\n❌ [${label}] Keys missing from docs/ENVIRONMENT.md:`);
    for (const k of missingInDoc) console.error(`   - ${k}`);
    exitCode = 1;
  }

  if (unexpected.length > 0) {
    console.error(`\n⚠️  [${label}] Keys in docs/ENVIRONMENT.md but not in .env.example:`);
    for (const k of unexpected) console.error(`   - ${k}`);
  }
}

if (exitCode === 0) {
  console.log("✅ docs/ENVIRONMENT.md is in sync with all .env.example files.");
}

process.exit(exitCode);
