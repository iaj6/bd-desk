# Rubric — Opportunity Radar sweep

Grade the sweep against the agent's sweep protocol (its `bd-radar-protocol`
skill). The deliverable is threefold: memory files updated correctly, qualified
targets pushed to the CRM, and an honest sweep report.

The sweep passes when ALL of the following hold:

1. **Protocol followed** — the agent read `_done.md` and `_frontier.md` FIRST; it
   did not re-map a sponsor already in `_done.md`; it popped sponsor(s) from the
   top of the frontier (or legitimately declared monitoring mode with the frontier
   drained); it moved mapped sponsors into `_done.md` with today's date; it
   appended newly-discovered sponsors to the bottom of `_frontier.md`.
2. **Cards written** — one `<company-slug>.md` card per qualified portco found,
   and RED/skip companies recorded with a one-line reason so they are not
   re-surfaced later.
3. **Report complete** — the tally line ("Mapped sponsor(s): X. N net-new targets
   carded. Frontier now: M sponsors."); a stop reason (budget with the frontier
   still queued, frontier drained → monitoring mode, or blocked and why) — a
   report that reads as exhaustive when the sweep merely spent its budget fails
   this; ranked net-new targets each with sponsor,
   HQ, fit + the specific GREEN signals, a why-now trigger, entry persona, and
   source URLs; the current frontier contents; the list of files written/updated.
4. **Grounded** — every carded target's fit cites specific GREEN signals with
   sources; no invented companies, sponsors, or certifications; anything
   unverified is marked "unverified".
5. **CRM pushes correct** — every NEW Strong / "Worth a look" target was POSTed to
   the CRM and the report says how many; no RED/skip or out-of-ICP node was
   pushed.
6. **Dedup respected** — nothing re-surfaced that was already carded, unless
   flagged UPDATE with a material new signal.

Judge honestly. A sweep that maps zero new sponsors is fine IF the frontier was
genuinely drained and monitoring mode found nothing — but a thin sweep with a full
frontier, a missing tally, or uncited fit claims needs revision.
