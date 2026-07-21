---
name: bd-sponsor-format
description: Load when profiling a PE sponsor for the operating-partner outreach play — the six-section structure, the portfolio ADD-flag rules, and grounding requirements.
---

# Sponsor profile — output format

This is prep + lead-gen: the portfolio enumeration is the payload. Produce:

# Sponsor Profile — <Fund>

1. **Snapshot** — what the fund is, size / AUM / fund count, HQ, founded, focus.
2. **Vertical thesis** — why they invest in the ICP's space (see the brand canon); the
   pattern they repeat.
3. **Portfolio** — EVERY current portco in the ICP's space you can
   find (platforms + add-ons). For each: a one-liner, a fit note vs the ICP in the brand canon, and
   **flag with `→ ADD` the ones worth adding as pipeline targets**. Be thorough; name portcos
   even if not widely known.
4. **Recent activity** — recaps, acquisitions, add-ons, fund closes in the last ~12
   months, with sources.
5. **Co-investors / lenders** — who they partner with (each is another sponsor cluster
   worth mapping).
6. **The play** — one line: how the offer templates across this fund's book in the
   ICP's space, and the sharpest angle for the outreach to the named partner.

Grounding: cite sources inline; mark anything you can't verify "unverified".

After the profile, emit the `<people>` block (the fund's partners / operating team,
including the partner being targeted), then the `<portcos>` block with every `→ ADD`
portco — both per the `bd-machine-blocks` skill.
