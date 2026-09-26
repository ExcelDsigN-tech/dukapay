/* eslint-disable @typescript-eslint/no-require-imports */
const nextJest = require("next/jest");

const createJestConfig = nextJest({
  dir: "./",
});

const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testPathIgnorePatterns: ["<rootDir>/e2e/", "<rootDir>/node_modules/"],
};

// next-intl and its ICU dependencies only ship ESM, so let Jest transform them.
const ESM_PACKAGES = ["next-intl", "use-intl", "intl-messageformat", "@formatjs", "icu-minify"];

module.exports = async () => {
  const config = await createJestConfig(customJestConfig)();
  config.transformIgnorePatterns = [
    `/node_modules/(?!(${ESM_PACKAGES.join("|")})/)`,
    ...config.transformIgnorePatterns.filter((pattern) => !pattern.startsWith("/node_modules/")),
  ];
  return config;
};
