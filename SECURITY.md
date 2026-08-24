# Security

## Reporting a vulnerability

Please report security issues privately through
[GitHub's private vulnerability reporting](https://github.com/iaj6/bd-desk/security/advisories/new)
rather than opening a public issue. I'll acknowledge within a few days.

## What this repo does with secrets

Worth understanding before you deploy it, because this system holds your pipeline and
can spend your API budget.

- **Nothing secret is committed.** `brand/brand-pack.yaml` (your positioning and ICP),
  `.managed-agents.json` (your provisioned resource ids), `.env*`, and all run outputs
  are gitignored. The tracked `brand-pack.example.yaml` describes a fictional company.
- **Agents never see credentials.** The Resend key and the CRM's MCP bearer are stored
  in a Managed Agents [vault](https://platform.claude.com/docs/en/managed-agents/overview)
  and substituted at egress, so they do not exist inside the agent sandbox.
- **Every CRM door fails closed.** If a door's secret is unset, that door returns 401
  rather than opening — cron (`CRON_SECRET`), MCP (`MCP_TOKEN`), agent ingest
  (`INGEST_TOKEN`), and the operator UI (`CRM_PASSWORD`). With no `CRM_PASSWORD` set,
  the CRM stays open only on a local dev server; on Vercel it returns 503 rather than
  publishing your pipeline. This is covered by tests in `tests/proxy.test.ts`.
- **Agent output is treated as untrusted.** It reaches spreadsheets, email, and the
  browser, so exports neutralize formula injection, the morning brief escapes every
  interpolated value, and the auto-add path whitelists fields rather than spreading
  whatever the model emitted.

## If you deploy this

- Set `CRM_PASSWORD` before your first production deploy.
- Use distinct, long random values for `CRON_SECRET`, `MCP_TOKEN`, and `INGEST_TOKEN`.
- The CRM holds real contact data about real people. Treat the Blob store and your
  exports accordingly, and check your obligations under GDPR/CCPA before you run
  outreach at any volume.
