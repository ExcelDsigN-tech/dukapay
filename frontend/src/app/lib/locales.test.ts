import fs from "fs";
import path from "path";
import { LOCALES, isLocale, localizePathname } from "./locales";

describe("locales", () => {
  it("has a messages file for every supported locale", () => {
    for (const locale of LOCALES) {
      expect(fs.existsSync(path.join(__dirname, "../../../messages", `${locale}.json`))).toBe(true);
    }
  });

  it("recognises only supported locales", () => {
    expect(isLocale("tl")).toBe(true);
    expect(isLocale("fr")).toBe(false);
  });

  it("swaps or adds the locale segment", () => {
    expect(localizePathname("/en/loans/42", "es")).toBe("/es/loans/42");
    expect(localizePathname("/en", "tl")).toBe("/tl");
    expect(localizePathname("/", "es")).toBe("/es");
    expect(localizePathname("/settings", "es")).toBe("/es/settings");
  });
});
