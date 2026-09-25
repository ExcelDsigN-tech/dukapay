import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Pages and components whose visible text is fully translated. Add a file here
// once it uses useTranslations() for everything it renders.
export const translatedFiles = [
  "src/app/[[]locale]/page.tsx",
  "src/app/[[]locale]/send-remittance/page.tsx",
  "src/app/[[]locale]/settings/page.tsx",
  "src/app/[[]locale]/wallet/page.tsx",
  "src/app/[[]locale]/lend/LendPageClient.tsx",
  "src/app/[[]locale]/loans/LoansPageClient.tsx",
  "src/app/[[]locale]/loans/[[]loanId]/LoanDetailsPageClient.tsx",
  "src/app/[[]locale]/repay/[[]loanId]/page.tsx",
  "src/app/components/remittance/RemittanceForm.tsx",
];

// Props that render text to the user, checked in addition to JSX children.
const TEXT_PROPS = [
  "label",
  "title",
  "placeholder",
  "description",
  "helperText",
  "alt",
  "aria-label",
  "actionLabel",
  "summary",
];

export const noHardcodedStrings = {
  files: translatedFiles,
  rules: {
    "react/jsx-no-literals": [
      "error",
      {
        noStrings: true,
        ignoreProps: true,
        // Symbols and currency codes are the same in every language.
        allowedStrings: [
          "*",
          "+",
          "-",
          "%",
          "•",
          "·",
          "▼",
          "✕",
          "…",
          "—",
          "/",
          "USDC",
          "EURC",
          "PHP",
        ],
      },
    ],
    "no-restricted-syntax": [
      "error",
      {
        selector: `JSXAttribute[name.name=/^(${TEXT_PROPS.join("|")})$/] > Literal[value=/[A-Za-z]/]`,
        message: "User visible text must come from useTranslations(), not a string literal.",
      },
    ],
  },
};

// Used by `npm run lint:i18n`: Next's parser and plugins, but only the i18n rule.
export default defineConfig([
  ...[...nextVitals, ...nextTypescript].map((config) => ({ ...config, rules: {} })),
  { linterOptions: { reportUnusedDisableDirectives: "off" } },
  noHardcodedStrings,
]);
