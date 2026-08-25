const fs = require('fs');
const path = require('path');

function collectKeys(obj, prefix = '') {
  const keys = [];
  for (const k of Object.keys(obj)) {
    const val = obj[k];
    const full = prefix ? `${prefix}.${k}` : k;
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      keys.push(...collectKeys(val, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function main() {
  const messagesDir = path.join(__dirname, '..', 'messages');
  const files = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.json'));
  const enPath = path.join(messagesDir, 'en.json');
  if (!fs.existsSync(enPath)) {
    console.error('en.json not found in messages directory');
    process.exit(2);
  }

  const en = loadJson(enPath);
  const enKeys = collectKeys(en);

  let hasError = false;

  for (const file of files) {
    if (file === 'en.json') continue;
    const localePath = path.join(messagesDir, file);
    const locale = loadJson(localePath);
    const localeKeys = new Set(collectKeys(locale));

    const missing = enKeys.filter((k) => !localeKeys.has(k));
    if (missing.length) {
      hasError = true;
      console.error(`Missing ${missing.length} keys in ${file}:`);
      missing.slice(0, 100).forEach((m) => console.error('  ' + m));
      if (missing.length > 100) console.error(`  ...and ${missing.length - 100} more`);
    }
  }

  if (hasError) {
    console.error('i18n validation failed: missing keys detected');
    process.exit(1);
  }

  console.log('i18n validation passed: all locale files contain en.json keys');
}

main();
