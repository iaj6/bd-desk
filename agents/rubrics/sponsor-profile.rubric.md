# Rubric — PE sponsor profile

Grade the FINAL sponsor profile the agent delivered (the deliverable, not the
research narration). This is prep + lead-gen: the portfolio enumeration is the
payload.

The profile passes when ALL of the following hold:

1. **Complete** — the six sections are present (Snapshot, Vertical thesis,
   Portfolio, Recent activity, Co-investors / lenders, The play), or a missing
   section is explicitly justified. No filler.
2. **Portfolio is thorough and scored** — the portcos found in the ICP's space are
   enumerated (platforms AND add-ons), each with a one-liner and
   a fit note against the ICP in the system prompt, and the ones worth pursuing are
   flagged `→ ADD`. An obviously thin portfolio section (one or two well-known
   names for a fund with a stated thesis in the space) needs revision.
3. **Grounded** — recent activity carries source URLs and dates; portcos and deals
   trace to something the agent actually found this session; anything unverified is
   marked "unverified". Invented portcos, invented partners, or constructed
   LinkedIn URLs fail outright.
4. **The play is specific** — one line on how the offer templates across THIS
   fund's book in the ICP's space and the sharpest angle for the named partner.
   Generic filler fails.
5. **Machine blocks valid** — the output ends with a `<people>[…]</people>` JSON
   array followed by a `<portcos>[…]</portcos>` JSON array, both valid JSON with
   nothing after the closing tags. Every `→ ADD` portco from the Portfolio section
   appears in `<portcos>` with at least company, sponsor, and fit ("Strong" or
   "Worth a look"); fields the agent could not verify are omitted, not guessed.
   Portcos that do not genuinely clear the ICP bar do NOT appear.
6. **Voice** — direct, practitioner-first, free of the NEVER-use words in the
   system prompt.

Judge honestly against the full scale. Do NOT penalize gaps where public
information genuinely does not exist, as long as they are acknowledged.
