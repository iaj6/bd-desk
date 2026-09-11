import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// One suite for the whole repo. `src/` (provisioning + run scripts) and `crm/`
// (the Next.js app) are separate npm projects, but their testable surface is plain
// TypeScript — running them together keeps `npm test` a single command.
//
// crm's dependencies live in crm/node_modules. Imports *inside* crm resolve there
// on their own; the alias is only so test files at the repo root can import the
// same modules the CRM does.
export default defineConfig({
  resolve: {
    alias: {
      "next/server": resolve(import.meta.dirname, "crm/node_modules/next/server.js"),
      // So a root test can vi.mock the same @vercel/blob module the CRM resolves.
      "@vercel/blob": resolve(import.meta.dirname, "crm/node_modules/@vercel/blob"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
