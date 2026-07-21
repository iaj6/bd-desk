---
name: bd-machine-blocks
description: Load whenever a deliverable must end with machine-readable people or portcos JSON blocks (BD dossiers, sponsor profiles). Exact block contracts, plus a validator script to run on the draft before delivering.
---

# Machine-readable blocks

Deliverables are parsed by the CRM. The machine blocks go at the very END of the
output, each JSON array wrapped in its tag, with **nothing after the final closing tag**.

## `<people>…</people>` — outreach contacts (dossiers AND sponsor profiles)

```
<people>[{ "name": "...", "title": "...", "persona": "<one of the buyer personas from the brand canon, or other>", "linkedin": "https://www.linkedin.com/in/…", "source": "https://…" }]</people>
```

Rules:
- 2–6 people, the ones most relevant for outreach, mapped to the buyer personas in the brand canon where possible.
- Pull names and titles from company leadership/team pages, deal press releases, and the
  PE sponsor's team page.
- Include `linkedin` ONLY if web search actually surfaced a real profile URL — never guess
  or construct one; omit the field if you didn't find one. LinkedIn pages can't be
  fetched, so any link is unverified.
- If you genuinely found no named people, emit `<people>[]</people>`.

## `<portcos>…</portcos>` — ADD-flagged portfolio companies (sponsor profiles only)

Emit every portco you flagged `→ ADD`, right after `</people>`:

```
<portcos>[{ "company": "...", "sponsor": "<this fund>", "hq": "...", "vertical": "...", "fit": "Strong" | "Worth a look", "why_now": "<the dated, specific trigger>", "entry_persona": "<likely buyer>", "green_signals": ["…"], "sources": ["https://…"] }]</portcos>
```

Rules:
- These are auto-added to the CRM as new targets — only include portcos that genuinely
  clear the ICP bar. Quality over count.
- Only `company`, `sponsor`, and `fit` are required; omit fields you couldn't verify
  rather than guessing.
- `fit` must be exactly `"Strong"` or `"Worth a look"`.

## Validate before delivering

Write your draft deliverable to a file and run the bundled validator on it:

```
python3 scripts/validate_blocks.py draft.md              # dossier: people block
python3 scripts/validate_blocks.py draft.md --portcos    # sponsor profile: people + portcos
```

Exit 0 means the blocks parse and follow every rule above. If it reports violations,
fix them and re-run — do not deliver a draft that fails validation.
