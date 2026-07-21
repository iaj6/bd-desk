---
name: bd-radar-protocol
description: Load when running an Opportunity Radar sweep — the memory worklist layout, the six-step sweep protocol, monitoring mode, dedup rules, CRM push rules, and the sweep report format.
---

# Opportunity Radar — sweep protocol

## Memory layout — /mnt/memory/bd-targets/  (read FIRST, write LAST)
The store is your shared brain across runs:
- **`_done.md`** — sponsors already mapped. NEVER re-map these.
- **`_frontier.md`** — sponsors discovered but NOT yet mapped. Your worklist (FIFO).
- **`_learnings.md`** — distilled sourcing lessons from past runs (dead-end sponsor
  shapes, angles that produced Strong targets, untapped angles). May not exist yet.
- **`<company-slug>.md`** — one qualifying card per target company.
- **`<sponsor-slug>.sponsor.md`** — one short cluster overview per mapped sponsor.

## Each sweep — run this exactly
1. **Read** `_done.md`, `_frontier.md`, and `_learnings.md` (if present — apply its
   lessons to this sweep's choices); skim existing card filenames so you know
   what's known.
2. **Refill the frontier if thin** (fewer than ~3 entries): discover NEW sponsors via
   several angles, preferring sponsors **not already connected** to mapped ones (so
   coverage reaches new regions, not just neighbors):
   - co-investors / competitors of sponsors already in `_done.md`,
   - **cert / registry directories** for the ICP's regulated posture (the
     certifications named in the brand canon) → find certified operators → who owns them,
   - recent **recap / M&A** news in the ICP's vertical (last ~6 months),
   - PE firm lists focused on the ICP's vertical.
3. **Pop** the next 2–3 sponsors from the top of `_frontier.md` and **delegate each to
   your Sponsor Mapper sub-agent — one thread per sponsor, launched in parallel**. Each
   delegation prompt: the sponsor name plus whatever memory already knows about it (a
   co-investor edge, a portco already carded). Do step 2's frontier refill yourself
   while the mappers work.
   When each map returns (prose + a `sponsor_map` JSON block):
   - Sanity-check anything that looks off — you own scoring judgment, the mapper is
     research help. Spot-verify a claim before carding it if in doubt.
   - Write a short `<company-slug>.md` card for each qualified portco (Strong /
     Worth a look). Record the map's RED/skip companies too (so they aren't
     re-surfaced) with one line.
   - Write/update a `<sponsor-slug>.sponsor.md` overview from the map.
   - Queue the map's `discovered_sponsors` for step 4.
4. **Extend the frontier:** append newly-discovered peer/co-sponsors to the bottom of
   `_frontier.md`.
5. **Close the loop:** move the mapped sponsor(s) from `_frontier.md` into `_done.md`
   with today's date (run `date` for it).
6. **Report** (format below).

**Monitoring mode** — when the frontier drains AND the core space is mapped: scan
trigger feeds (recaps in the last ~30 days, new RFPs, new cert holders) for genuinely
NEW nodes; add only nodes not already in memory. Say you're in monitoring mode and how
many new nodes you found (often zero — that's fine).

## Dedup rule
Never re-surface a company already carded or a sponsor in `_done.md`, unless there's a
material new signal — then mark the card "UPDATE" and say why.

## Push qualified targets to the CRM
After you write a NEW target's memory card, if its fit is **Strong** or
**Worth a look**, add it with the **`crm_add_target` tool**. Do NOT add RED/skip or
out-of-ICP nodes — those stay in memory for dedup only.
- Pass everything you qualified: `company` (required), `sponsor`, `hq`, `vertical`,
  `fit`, `green_signals`, `why_now`, `entry_persona`, `sources` — and always
  `manual: false` (you are an agent).
- `fit` must be exactly `"Strong"` or `"Worth a look"`.
- The CRM upserts by company — re-adding an existing company won't duplicate or reset a
  human-set status. A successful call returns `{"ok":true, ...}`.
- `crm_list_targets` shows the pipeline if you need to cross-check beyond your memory.

## Sweep report format
- One-line tally: "Mapped sponsor(s): X. N net-new targets carded. Frontier now: M sponsors."
- **Why the sweep stopped** — one line, every sweep: "budget — mapped the per-sweep
  2–3, frontier still has M queued" or "frontier drained → monitoring mode (N new
  nodes)" or "blocked: <what went wrong>". Never let the report imply the territory
  is exhausted when the sweep just hit its budget.
- Ranked (best-fit first) net-new targets: **Company** + **sponsor** + HQ · **Fit**
  (+ which GREEN signals) · **Why now** (trigger) · **Entry persona** · **Sources** (URLs).
- The current `_frontier.md` contents (so the human sees what's queued next).
- Which files you wrote/updated, and how many targets you pushed to the CRM.
