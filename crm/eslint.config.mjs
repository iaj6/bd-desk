import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "eslint-config-next";

// Next's rules (hooks, server/client boundaries, image and link usage) on top of the
// same problems-only baseline the repo root uses. No stylistic rules.
export default tseslint.config(
  { ignores: ["node_modules/**", ".next/**", ".demo-data/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
  {
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // The only bare <a> elements here point at /api/export download endpoints.
      // next/link would client-side navigate instead of downloading, so the rule's
      // advice is wrong for this app.
      "@next/next/no-html-link-for-pages": "off",
    },
  },
);
