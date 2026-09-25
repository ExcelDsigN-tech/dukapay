import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import tl from "../../../messages/tl.json";

type Messages = { [key: string]: string | Messages };

// Namespaces used by the fully translated pages (see eslint.i18n.config.mjs).
const NAMESPACES = [
  "HomePage",
  "SendRemittance",
  "RemittanceForm",
  "Settings",
  "WalletPage",
  "Lend",
  "Loans",
  "LoanDetails",
  "RepayLoan",
];

function flatten(messages: Messages, prefix = ""): Record<string, string> {
  return Object.entries(messages).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string"
      ? { ...acc, [path]: value }
      : { ...acc, ...flatten(value, path) };
  }, {});
}

function placeholders(message: string) {
  return [...message.matchAll(/\{(\w+)/g)].map((m) => m[1]).sort();
}

describe.each([
  ["es", es],
  ["tl", tl],
])("%s messages", (_locale, messages) => {
  it.each(NAMESPACES)("%s has every English key with the same placeholders", (namespace) => {
    const source = flatten((en as unknown as Messages)[namespace] as Messages);
    const target = flatten(((messages as unknown as Messages)[namespace] ?? {}) as Messages);

    expect(Object.keys(target).sort()).toEqual(Object.keys(source).sort());
    for (const [key, value] of Object.entries(source)) {
      expect({ key, placeholders: placeholders(target[key]) }).toEqual({
        key,
        placeholders: placeholders(value),
      });
    }
  });
});
