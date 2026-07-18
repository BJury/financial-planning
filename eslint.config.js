// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import globals from "globals";

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
      // Catalog type implementations (SPEC.md §3.11/§9.4) share one
      // interface signature across ~10 modules; not every type uses
      // every parameter (e.g. Salary's calculateForYear ignores `owner`).
      // A leading underscore is the standard, explicit "intentionally
      // unused" marker — allow it rather than forcing awkward workarounds.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // `onChange={(v) => setSomething(v)}` (a void-returning setter call
      // as an arrow-function-shorthand body) is idiomatic, unambiguous
      // React — only flag the genuinely confusing cases (a void
      // expression inside a larger expression), not this one.
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
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
    // packages/engine must stay platform-agnostic (SPEC.md §9.1) — no
    // browser or Node globals assumed available here.
    files: ["packages/engine/**/*.ts"],
    languageOptions: {
      globals: {},
    },
  },
  {
    // apps/web is a browser-only static site (SPEC.md §9.1) — no Node
    // globals, only the browser platform.
    files: ["apps/web/**/*.ts", "apps/web/**/*.tsx"],
    languageOptions: {
      globals: globals.browser,
    },
  },
];
