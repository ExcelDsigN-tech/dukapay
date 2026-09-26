import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { noHardcodedStrings } from "./eslint.i18n.config.mjs";

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  noHardcodedStrings,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);
