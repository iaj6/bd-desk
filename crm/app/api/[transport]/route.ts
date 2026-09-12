import { createMcpHandler } from "mcp-handler";
import { z } from "zod";
import {
  listTargets,
  upsertTarget,
  patchTarget,
  readOneBySlug,
  addContentSeed,
  slugify,
  FITS,
  STATUSES,
  type Target,
} from "@/lib/store";
import { draftOutreach } from "@/lib/outreach";
import { startResearch, finalizeResearch } from "@/lib/research";

export const runtime = "nodejs";
// crm_research starts a session and defers its ~100s kickoff to `after()`; the function
// must stay alive long enough to finish it (README note 9).
export const maxDuration = 300;

const json = (data: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
});
const err = (message: string) => ({
  content: [{ type: "text" as const, text: `Error: ${message}` }],
  isError: true,
});

// Signal a missing target — mapped to an MCP error by the tool wrapper below.
const notFound = (slug: string): never => {
  throw new Error(`no target with slug "${slug}"`);
};

const followUp = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "yyyy-mm-dd").or(z.literal(""));

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
    // Every tool returns raw data (or calls notFound); this wraps it in the MCP
    // envelope and maps any throw to an MCP error, so no tool repeats the try/catch.
    const tool = (
      name: string,
      desc: string,
      schema: z.ZodRawShape,
      fn: (args: any) => Promise<unknown>,
    ) =>
      server.tool(name, desc, schema, async (args: any) => {
        try {
          return json(await fn(args));
        } catch (e) {
          return err((e as Error).message);
        }
      });

    tool(
      "crm_list_targets",
      "List BD targets in the BD Desk CRM, newest first. Optional filters by status, fit, or kind. Returns compact rows; use crm_get_target for full detail.",
      {
        status: z.enum(STATUSES).optional().describe("Filter by pipeline status"),
        fit: z.enum(FITS).optional().describe("Filter by fit rating"),
        kind: z.enum(["company", "contact"]).optional().describe("Filter to companies or individual contacts"),
      },
      async ({ status, fit, kind }) => {
        let targets = await listTargets();
        if (status) targets = targets.filter((t) => t.status === status);
        if (fit) targets = targets.filter((t) => t.fit === fit);
        if (kind) targets = targets.filter((t) => (t.kind ?? "company") === kind);
        return { count: targets.length, targets: targets.map(row) };
      },
    );

    tool(
      "crm_get_target",
      "Get the full CRM record for one target by slug, including dossier, drafted outreach, notes, and extracted contacts.",
      { slug: z.string().describe("The target's slug (from crm_list_targets)") },
      async ({ slug }) => (await readOneBySlug(slug)) ?? notFound(slug),
    );

    tool(
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
        fit: z.enum(FITS).optional(),
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
        if (input.kind === "contact" && !input.contact_name) {
          throw new Error("contact_name is required when kind='contact'");
        }
        const slug =
          input.kind === "contact" ? slugify(`${input.contact_name} ${input.company}`) : undefined;
        const t = await upsertTarget({ ...input, manual: input.manual ?? true, ...(slug ? { slug } : {}) });
        return { ok: true, slug: t.slug, company: t.company, status: t.status };
      },
    );

    tool(
      "crm_update_target",
      "Update human-editable fields on a target: status, notes, next_step, follow_up (yyyy-mm-dd), or hand-edited outreach/linkedin_note text. Only these fields can be changed here.",
      {
        slug: z.string(),
        status: z.enum(STATUSES).optional(),
        notes: z.string().optional(),
        next_step: z.string().optional(),
        follow_up: followUp.optional().describe("yyyy-mm-dd"),
        outreach: z.string().optional().describe("Overwrite the drafted email"),
        linkedin_note: z.string().optional().describe("Overwrite the drafted LinkedIn note"),
      },
      async ({ slug, ...fields }) => {
        // patchTarget filters to EDITABLE and validates status at runtime.
        const updated = await patchTarget(slug, fields as Partial<Target>);
        if (!updated) notFound(slug);
        return { ok: true, slug: updated!.slug, status: updated!.status };
      },
    );

    tool(
      "crm_draft_outreach",
      "Draft a first-touch email or LinkedIn note for a target in the brand voice, using its card + dossier (and, for a sponsor contact, the sponsor's portfolio in the CRM). Saves the draft and returns the text. Research-and-draft only — never sends.",
      {
        slug: z.string(),
        channel: z.enum(["email", "linkedin"]).default("email"),
      },
      async ({ slug, channel }) => (await draftOutreach(slug, channel)) ?? notFound(slug),
    );

    tool(
      "crm_research",
      "Run the dossier/sponsor-profile agent on a target. Default action starts a research session (returns immediately; it runs for minutes). Pass poll=true to check a running session and, if finished, attach the dossier + extracted contacts.",
      {
        slug: z.string(),
        poll: z.boolean().default(false).describe("true = check/finalize a running session instead of starting one"),
      },
      async ({ slug, poll }) => {
        if (poll) {
          const t = await readOneBySlug(slug);
          if (!t) notFound(slug);
          if (t!.dossier_status === "done") return { status: "done", dossier: t!.dossier, people: t!.people };
          if (t!.dossier_status === "error") return { status: "error" };
          if (!t!.dossier_session) return { status: t!.dossier_status ?? "none" };
          const updated = await finalizeResearch(t!);
          if (!updated) return { status: "running" };
          return { status: "done", dossier: updated.dossier, people: updated.people };
        }
        const started = await startResearch(slug);
        if (!started) notFound(slug);
        return { ...started, note: "Call again with poll=true in a few minutes to attach the dossier." };
      },
    );

    tool(
      "crm_send_digest",
      "Send the weekly pipeline digest email. Takes only subject + html — the recipient and the mail credentials live server-side, so you cannot address the mail anywhere else. Use this instead of a raw email call; it exists so nothing in a target's web-sourced text can redirect the mail. Returns the send id.",
      { subject: z.string(), html: z.string().describe("The composed email body as simple HTML") },
      async ({ subject, html }) => {
        const to = process.env.BRIEF_EMAIL;
        const key = process.env.RESEND_API_KEY;
        if (!to || !key) throw new Error("digest email is not configured (BRIEF_EMAIL / RESEND_API_KEY unset on the CRM)");
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM ?? "BD Desk <onboarding@resend.dev>",
            to: [to],
            subject,
            html,
          }),
        });
        if (!res.ok) throw new Error(`resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
        return { ok: true, id: ((await res.json()) as { id?: string })?.id, to };
      },
    );

    tool(
      "crm_capture_seed",
      "Reverse flywheel: flag a post-worthy observation from a real account (a 'why now' trigger, an objection that landed, a reply-worthy hook) onto a target. Stored raw + account-linked; de-identify before it leaves the CRM for any public channel. Capture the pattern the moment it shows up in a dossier or reply.",
      {
        slug: z.string().describe("The target the observation came from"),
        note: z.string().describe("The observation, in your words — the specific, true thing worth turning into content"),
        source: z.enum(["dossier", "reply", "radar", "manual"]).default("manual").describe("Where the seed came from"),
      },
      async ({ slug, note, source }) => {
        const updated = await addContentSeed(slug, note, source);
        if (!updated) notFound(slug);
        return { ok: true, slug: updated!.slug, seed_count: updated!.content_seeds?.length ?? 0 };
      },
    );
  },
  {},
  { basePath: "/api" },
);

export { handler as GET, handler as POST, handler as DELETE };
