# Pre-Engagement Dossier — Cascade Provisions Co.

_Demo mode: canned output. The real pipeline calls a graded research agent._

## Fit score

**Strong.** Cascade Provisions Co. hits three GREEN signals: PE ownership under Calderwick Capital with a
stated margin-improvement mandate, an SQF-certified plant with a renewal audit this
year, and two open analyst reqs (yield, cost) against zero data-engineering reqs.
That last one is the tell — they are hiring people to work around the missing data
layer rather than building it.

## The angle

Their quality team is rebuilding the audit binder by hand every cycle while the ops
team reconciles yield in a spreadsheet only one analyst understands. Both grinds are
in scope for a single engagement, and the audit date is a real deadline to build
against.

## Snapshot

- Mid-market manufacturer, roughly 300 employees across two plants (unverified — no
  filing confirms headcount).
- ERP in place; the analytical layer above it is Excel plus a shared drive.
- Sponsor: Calderwick Capital.

## Recent signals

- Announced a second production line, per their newsroom — https://example.com/news/line-two
- Two analyst roles open, no data-engineering or ML reqs — https://example.com/careers
- SQF certification listed as current; renewal window this year — https://example.com/quality

## Where we fit

The yield reconciliation is the wedge: lot-level data out of the ERP, cleaned, and
queryable in plain English by the ops team rather than by one analyst. The audit
document assistant follows it, built against the renewal date. Both run inside their
own cloud account, which is the objection that kills most tools here.

Honest caveat: if their ERP rollout is still in flight, the data layer is not stable
enough yet and this is a six-month conversation, not a now conversation.

## Likely buyer

VP Operations owns the yield number and can greenlight a pilot at this size. Quality
leadership can bless or kill it on traceability grounds, so bring them in early.

## Conversation hooks

- What happens to the yield report when the analyst who owns it takes PTO?
- How much of the audit binder gets rebuilt by hand each cycle?
- Where did the last "we tried ChatGPT" pilot stall — legal, or accuracy?


<people>
[
  {
    "name": "Dana Whitfield",
    "title": "VP Operations",
    "persona": "Ops / Plant leader",
    "source": "https://example.com/team"
  },
  {
    "name": "Marcus Iyer",
    "title": "Director of Quality & Food Safety",
    "persona": "Quality / Food Safety leader",
    "source": "https://example.com/team"
  },
  {
    "name": "Priya Raghunathan",
    "title": "CFO",
    "persona": "PE-backed exec",
    "source": "https://example.com/leadership"
  }
]
</people>
