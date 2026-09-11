// Load the repo's .env (if present) so ANTHROPIC_API_KEY and the delivery/CRM vars are
// picked up automatically. Import this FIRST in every entry script — `import "./env.ts";`
// — so a reader who follows the README (`cp .env.example .env`) doesn't hit an auth
// error from a script that simply never read the file.
import { existsSync } from "node:fs";

try {
  if (existsSync(".env")) process.loadEnvFile(".env");
} catch {
  /* .env is optional; an exported ANTHROPIC_API_KEY works too */
}
