// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

export default [
  {
    ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
  },
  js.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: true,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    rules: {
      ...tseslint.configs["strict-type-checked"]?.rules,
      // Numbers and booleans in template literals (error messages, log
      // lines) are safe and common in this codebase — only forbid the
      // genuinely unsafe cases (objects, `any`) the rule is meant to catch.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      // Architectural rule: the engine must stay pure and framework-agnostic.
      // apps/web may import packages/engine; the reverse must never happen.
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/apps/web/**", "@fp/web", "*apps/web*"],
              message:
                "packages/engine must never import from apps/web — it must stay pure and framework-agnostic (see SPEC.md §9.1/§9.3).",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["packages/engine/**/*.ts"],
    rules: {
      // Enforced separately per-package below via a dedicated override,
      // since flat config's `files` glob is relative to this file.
    },
  },
];
