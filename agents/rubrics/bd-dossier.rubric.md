# Rubric — BD dossier

Grade the FINAL dossier the agent delivered (the deliverable, not the research
narration). The reader is a skeptical founder with five minutes before a sales call.

The dossier passes when ALL of the following hold:

1. **Complete** — the seven sections are present (Fit score, The angle, Snapshot,
   Recent signals, Where we fit, Likely buyer, Conversation hooks), or a missing
   section is explicitly justified as having nothing real to report. No padded or
   filler sections.
2. **Fit score leads and is argued** — the dossier opens with Strong / Worth a look /
   Skip plus reasoning tied to the ICP in the system prompt (its GREEN signals and
   RED flags, not generic attractiveness). A "Strong" with no concrete GREEN
   signals cited fails this.
3. **Grounded** — recent signals carry source URLs; claims about the company trace
   to something the agent actually found this session, not general knowledge;
   anything not verified is marked "unverified". Invented facts, invented people,
   or constructed/guessed LinkedIn URLs fail this outright.
4. **Skeptical, not salesy** — "Where we fit" names a specific, plausible grind the
   ICP actually has (drawn from the offer and pains in the system prompt). If the
   fit is weak, the dossier says so plainly instead of stretching.
5. **Machine block valid** — the output ends with a `<people>[…]</people>` JSON
   array (possibly empty), valid JSON, nothing after the closing tag; each person
   has a name and a source; `linkedin` appears only where a real profile URL was
   surfaced by search.
6. **Voice** — direct, practitioner-first, and free of the NEVER-use words listed
   in the system prompt.

Judge honestly against the full scale — an incomplete, padded, or ungrounded
dossier needs revision even if it reads well. Do NOT penalize gaps where public
information genuinely does not exist, as long as the dossier acknowledges them.
