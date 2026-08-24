# Contributing

Thanks for taking a look. This repo is a working reference implementation, not a
product — the most useful contributions are usually a sharper platform note, a fix to
something that broke against a newer API version, or a rough edge in setup.

## Getting the repo running

You do not need an Anthropic key or a Vercel account to work on the CRM:

```bash
cd crm && npm install && npm run demo    # seeded board at http://localhost:3010
```

To work on the agents themselves you need an Anthropic API key with Managed Agents
access — see [Setup](README.md#setup). Research sessions run Claude Opus for minutes
at a time and cost real money, so use `evals/tasks.json` with a small task list while
iterating.

## Before opening a PR

```bash
npm run check              # lint + typecheck + tests, at the repo root
cd crm && npm run lint && npm run typecheck && npm run build
```

CI runs exactly these, plus a job that boots demo mode with no credentials.

## Conventions

- **Two npm projects.** The repo root (`src/`, provisioning and run scripts) and
  `crm/` (the Next.js app) each have their own `package.json` and lockfile. Tests for
  both live in `tests/` at the root and run with one `npm test`.
- **Lint catches problems, not style.** There is no formatter on purpose — match the
  surrounding code rather than reformatting it, so diffs stay readable.
- **Comments explain why.** The valuable ones here record a platform behaviour that
  cost time to learn. If you work one out, write it down — and consider adding it to
  the README's "Hard-won platform notes".
- **The human gate is not negotiable.** Every automated path stops at a draft. A
  change that lets the system send anything on its own will not be merged.
- **Keep the CRM's rubric copy in sync.** `crm/lib/rubrics.ts` deliberately duplicates
  `agents/rubrics/*.md`; a test enforces it.

## Reporting bugs

Include the Managed Agents beta version you are on (`managed-agents-2026-04-01` at
time of writing), what you ran, and what happened. Platform behaviour on a beta
surface changes — if something in the README's platform notes is now wrong, that is
worth an issue on its own.

Security issues: see [SECURITY.md](SECURITY.md) — please do not open a public issue.
