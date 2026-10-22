import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // App code must not log freely: requests can carry licence keys (Dodo's return URL),
    // webhook bodies hold buyer data, and errors can include API keys or connection strings.
    // Each allowed call is reviewed and carries an eslint-disable comment saying why it is safe.
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/**/*.test.{ts,tsx}", "src/test/**"],
    rules: { "no-console": "error" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated code.
    "src/generated/**",
    "coverage/**",
  ]),
]);

export default eslintConfig;
