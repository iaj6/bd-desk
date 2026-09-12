// One zod schema for every write into the target store, so the REST doors validate the
// same way the MCP door already does — a malformed field can't reach storage and then
// 500 every export or crash the drawer. Kept next to the types; the enums come straight
// from lib/types so the schema can't drift from them.

import { z } from "zod";
import { FITS, STATUSES } from "./types";

// yyyy-mm-dd, or "" to clear the field. An agent-written free-text date otherwise never
// comes due and silently disappears from the "due" view.
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected a YYYY-MM-DD date")
  .or(z.literal(""));

const strList = z.array(z.string());

// Ingest: the sourced fields an agent or a hand-add may supply. Unknown keys are
// stripped rather than stored. status/discovered_at/updated_at are server-owned.
export const TargetInput = z
  .object({
    company: z.string().min(1, "company is required"),
    slug: z.string().optional(),
    kind: z.enum(["company", "contact"]).optional(),
    contact_name: z.string().optional(),
    contact_title: z.string().optional(),
    sponsor: z.string().optional(),
    hq: z.string().optional(),
    vertical: z.string().optional(),
    fit: z.enum(FITS).optional(),
    green_signals: strList.optional(),
    why_now: z.string().optional(),
    entry_persona: z.string().optional(),
    sources: strList.optional(),
    manual: z.boolean().optional(),
  })
  .strip();
export type TargetInput = z.infer<typeof TargetInput>;

// Human edits via the drawer (and the MCP crm_update_target tool): only the fields a
// person owns. The async research state (dossier_status/session, people, grade) is
// written by finalizeResearch, never over the HTTP PATCH door.
export const PatchInput = z
  .object({
    status: z.enum(STATUSES),
    notes: z.string(),
    next_step: z.string(),
    follow_up: isoDate,
    outreach: z.string(),
    linkedin_note: z.string(),
    dossier: z.string(),
    contact_name: z.string(),
    contact_title: z.string(),
  })
  .partial()
  .strip();
export type PatchInput = z.infer<typeof PatchInput>;

// Format a zod error as one short line for an API response.
export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
}
