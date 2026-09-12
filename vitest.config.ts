import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// One suite for the whole repo. `src/` (provisioning + run scripts) and `crm/`
// (the Next.js app) are separate npm projects, but their testable surface is plain
// TypeScript — running them together keeps `npm test` a single command.
//
// crm's dependencies live in crm/node_modules. Imports *inside* crm resolve there
// on their own; these aliases are only so test files at the repo root can import (and
// vi.mock) the same modules the CRM does. Array form + a scoped `@` regex so the path
// alias doesn't swallow scoped packages like `@anthropic-ai/sdk`.
const crm = resolve(import.meta.dirname, "crm");
export default defineConfig({
  resolve: {
    alias: [
      { find: "next/server", replacement: resolve(crm, "node_modules/next/server.js") },
      { find: "@vercel/blob", replacement: resolve(crm, "node_modules/@vercel/blob") },
      { find: "@anthropic-ai/sdk", replacement: resolve(crm, "node_modules/@anthropic-ai/sdk") },
      // The CRM's own `@/…` path alias (crm/tsconfig maps it to the crm root).
      { find: /^@\//, replacement: crm + "/" },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
  },
});
