import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Lint for real problems only — no stylistic rules. The repo has a consistent hand
// style and reformatting it would bury the history under noise.
// crm/ has its own config (Next's rules on top of these); this one covers src/ and
// tests/.
export default tseslint.config(
  { ignores: ["node_modules/**", "crm/**", "dossiers/**", "radar-runs/**", "evals/runs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
      globals: { process: "readonly", console: "readonly", Buffer: "readonly", fetch: "readonly" },
    },
    rules: {
      // These scripts are CLIs: console output IS the interface.
      "no-console": "off",
      // The Managed Agents beta surface outruns its published types in places; the
      // repo uses `any` deliberately and narrowly there.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
