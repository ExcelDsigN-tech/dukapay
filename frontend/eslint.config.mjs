import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { noHardcodedStrings } from "./eslint.i18n.config.mjs";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  noHardcodedStrings,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
  {
    // Issue #611: Triage pre-existing ESLint errors so ESLint can run in CI
    rules: {
      // Align with backend/.eslintrc.cjs rule level (warn instead of error)
      "@typescript-eslint/no-explicit-any": "warn",
      // React 19 / Next 16 Compiler rules: warn during migration
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/static-components": "warn",
      "react/no-unescaped-entities": "warn",
    },
  },
  {
    // Issue #611: Pre-existing rules-of-hooks violations tracked in separate component issues
    files: [
      "src/app/components/gamification/LevelUpModal.tsx",
      "src/app/components/ui/CreditScoreGauge.tsx",
    ],
    rules: {
      "react-hooks/rules-of-hooks": "warn",
    },
  },
]);
