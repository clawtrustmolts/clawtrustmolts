import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import securityPlugin from "eslint-plugin-security";

// Stub for react-hooks rules referenced in disable comments throughout the
// client code. eslint-plugin-react-hooks@7 does not support ESLint 10 yet.
// This stub prevents "Definition for rule not found" errors while keeping
// the disable comments working as intended.
const reactHooksStub = {
  meta: { name: "react-hooks-stub" },
  rules: {
    "exhaustive-deps": { create: () => ({}) },
    "rules-of-hooks": { create: () => ({}) },
  },
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "contracts/**",
      "**/*.min.js",
      "script/build.ts",
    ],
  },

  {
    files: ["**/*.ts", "**/*.tsx"],
    plugins: {
      "@typescript-eslint": typescriptEslint,
      security: securityPlugin,
      "react-hooks": reactHooksStub,
    },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
      },
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,

      // Downgrade noisy TypeScript rules to warn so day-one warnings don't
      // block the build — tighten these progressively as the codebase improves.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-require-imports": "warn",
      // This fires on optional-chain + non-null-assertion (pattern used throughout)
      "@typescript-eslint/no-non-null-asserted-optional-chain": "warn",

      // React-hooks stub rules — kept at warn so disable comments are respected
      "react-hooks/exhaustive-deps": "warn",
      "react-hooks/rules-of-hooks": "warn",

      // Security rules — warn on day one, upgrade to error progressively
      "security/detect-object-injection": "warn",
      "security/detect-non-literal-fs-filename": "warn",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-unsafe-regex": "warn",
      "security/detect-child-process": "warn",
      "security/detect-possible-timing-attacks": "warn",

      // These are high confidence — keep as error
      "security/detect-buffer-noassert": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-eval-with-expression": "error",
      "security/detect-new-buffer": "error",
      "security/detect-no-csrf-before-method-override": "error",
      "security/detect-pseudoRandomBytes": "error",

      // Core dangerous JS patterns — error level
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-proto": "error",
      "no-iterator": "error",
    },
  },
];
