import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  listTargets,
  upsertTarget,
  patchTarget,
  readOneBySlug,
  addContentSeed,
  slugify,
  STATUSES,
  type Target,
} from "@/lib/store";
import { draftOutreach } from "@/lib/outreach";
import { startResearch, finalizeResearch } from "@/lib/research";

export const runtime = "nodejs";
export const maxDuration = 60;

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const err = (message: string) => ({
  content: [{ type: "text" as const, text: `Error: ${message}` }],
  isError: true,
});

// A compact row for list results — the full record is available via crm_get_target.
const row = (t: Target) => ({
  slug: t.slug,
  company: t.company,
  kind: t.kind ?? "company",
  contact_name: t.contact_name,
  sponsor: t.sponsor,
  fit: t.fit,
  status: t.status,
  next_step: t.next_step,
  follow_up: t.follow_up,
  has_dossier: Boolean(t.dossier),
  has_outreach: Boolean(t.outreach || t.linkedin_note),
  discovered_at: t.discovered_at,
});

const handler = createMcpHandler(
  (server) => {
    server.tool(
      "crm_list_targets",
      "List BD targets in the BD Desk CRM, newest first. Optional filters by status, fit, or kind. Returns compact rows; use crm_get_target for full detail.",
      {
        status: z.enum(STATUSES as [string, ...string[]]).optional().describe("Filter by pipeline status"),
        fit: z.enum(["Strong", "Worth a look", "Skip"]).optional().describe("Filter by fit rating"),
        kind: z.enum(["company", "contact"]).optional().describe("Filter to companies or individual contacts"),
      },
      async ({ status, fit, kind }) => {
        try {
          let targets = await listTargets();
          if (status) targets = targets.filter((t) => t.status === status);
          if (fit) targets = targets.filter((t) => t.fit === fit);
          if (kind) targets = targets.filter((t) => (t.kind ?? "company") === kind);
          return json({ count: targets.length, targets: targets.map(row) });
        } catch (e) {
          return err((e as Error).message);
        }
      },
    );

    server.tool(
      "crm_get_target",
      "Get the full CRM record for one target by slug, including dossier, drafted outreach, notes, and extracted contacts.",
      { slug: z.string().describe("The target's slug (from crm_list_targets)") },
      async ({ slug }) => {
        try {
          const t = await readOneBySlug(slug);
          if (!t) return err(`no target with slug "${slug}"`);
          return json(t);
        } catch (e) {
          return err((e as Error).message);
        }
      },
    );

    server.tool(
      "crm_add_target",
      "Add (or upsert) a BD target. Set kind='contact' for an individual (e.g. a PE operating partner) — then contact_name is required. Preserves existing human triage state on re-add.",
      {
        company: z.string().describe("Company or organization name (required)"),
        kind: z.enum(["company", "contact"]).optional().describe("'contact' = a person you're reaching out to"),
        contact_name: z.string().optional().describe("Person's name (required when kind='contact')"),
        contact_title: z.string().optional(),
        sponsor: z.string().optional().describe("PE sponsor / owner"),
        hq: z.string().optional(),
        vertical: z.string().optional(),
        fit: z.enum(["Strong", "Worth a look", "Skip"]).optional(),
        why_now: z.string().optional().describe("The trigger / reason to reach out now"),
        entry_persona: z.string().optional().describe("Likely buyer persona"),
        green_signals: z.array(z.string()).optional().describe("ICP GREEN signals this target shows"),
        sources: z.array(z.string()).optional().describe("Source URLs backing the qualification"),
        notes: z.string().optional(),
        manual: z
          .boolean()
          .optional()
          .describe("false when added by an automated agent (e.g. the Radar); defaults to true for hand-added targets"),
      },
      async (input) => {
        try {
          if (input.kind === "contact" && !input.contact_name) {
            return err("contact_name is required when kind='contact'");
          }
          const slug =
            input.kind === "contact"
              ? slugify(`${input.contact_name} ${input.company}`)
              : undefined;
          const t = await upsertTarget({ ...input, manual: input.manual ?? true, ...(slug ? { slug } : {}) });
          return json({ ok: true, slug: t.slug, company: t.company, status: t.status });
        } catch (e) {
          return err((e as Error).message);
        }
      },
    );

    server.tool(
      "crm_update_target",
      "Update human-editable fields on a target: status, notes, next_step, follow_up (yyyy-mm-dd), or hand-edited outreach/linkedin_note text. Only these fields can be changed here.",
      {
        slug: z.string(),
        status: z.enum(STATUSES as [string, ...string[]]).optional(),
        notes: z.string().optional(),
        next_step: z.string().optional(),
        follow_up: z.string().optional().describe("yyyy-mm-dd"),
        outreach: z.string().optional().describe("Overwrite the drafted email"),
        linkedin_note: z.string().optional().describe("Overwrite the drafted LinkedIn note"),
      },
      async ({ slug, ...fields }) => {
        try {
          // patchTarget filters to EDITABLE and validates status at runtime.
          const updated = await patchTarget(slug, fields as Partial<Target>);
          if (!updated) return err(`no target with slug "${slug}"`);
          return json({ ok: true, slug: updated.slug, status: updated.status });
        } catch (e) {
          return err((e as Error).message);
        }
      },
    );

    server.tool(
      "crm_draft_outreach",
      "Draft a first-touch email or LinkedIn note for a target in the brand voice, using its card + dossier (and, for a sponsor contact, the sponsor's portfolio in the CRM). Saves the draft and returns the text. Research-and-draft only — never sends.",
      {
        slug: z.string(),
        channel: z.enum(["email", "linkedin"]).default("email"),
      },
      async ({ slug, channel }) => {
        try {
          const result = await draftOutreach(slug, channel);
          if (!result) return err(`no target with slug "${slug}"`);
          return json(result);
        } catch (e) {
          return err((e as Error).message);
        }
      },
    );

    server.tool(
      "crm_research",
      "Run the dossier/sponsor-profile agent on a target. Default action starts a research session (returns immediately; it runs for minutes). Pass poll=true to check a running session and, if finished, attach the dossier + extracted contacts.",
      {
        slug: z.string(),
        poll: z.boolean().default(false).describe("true = check/finalize a running session instead of starting one"),
      },
      async ({ slug, poll }) => {
        try {
          if (poll) {
            const t = await readOneBySlug(slug);
            if (!t) return err(`no target with slug "${slug}"`);
            if (t.dossier_status === "done") return json({ status: "done", dossier: t.dossier, people: t.people });
            if (!t.dossier_session) return json({ status: t.dossier_status ?? "none" });
            const updated = await finalizeResearch(t);
            if (!updated) return json({ status: "running" });
            return json({ status: "done", dossier: updated.dossier, people: updated.people });
          }
          const started = await startResearch(slug);
          if (!started) return err(`no target with slug "${slug}"`);
          return json({ ...started, note: "Call again with poll=true in a few minutes to attach the dossier." });
        } catch (e) {
          return err((e as Error).message);
        }
      },
    );

    server.tool(
      "crm_capture_seed",
      "Reverse flywheel: flag a post-worthy observation from a real account (a 'why now' trigger, an objection that landed, a reply-worthy hook) onto a target. Stored raw + account-linked; de-identify before it leaves the CRM for any public channel. Capture the pattern the moment it shows up in a dossier or reply.",
      {
        slug: z.string().describe("The target the observation came from"),
        note: z.string().describe("The observation, in your words — the specific, true thing worth turning into content"),
        source: z.enum(["dossier", "reply", "radar", "manual"]).default("manual").describe("Where the seed came from"),
      },
      async ({ slug, note, source }) => {
        try {
          const updated = await addContentSeed(slug, note, source);
          if (!updated) return err(`no target with slug "${slug}"`);
          return json({ ok: true, slug: updated.slug, seed_count: updated.content_seeds?.length ?? 0 });
        } catch (e) {
          return err((e as Error).message);
        }
      },
    );
  },
  {},
  { basePath: "/api" },
);

export { handler as GET, handler as POST, handler as DELETE };
