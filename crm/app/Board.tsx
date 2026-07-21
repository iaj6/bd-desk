"use client";

import { useEffect, useState } from "react";
import { STATUSES, type Status, type Target } from "@/lib/store";

const fitClass = (fit?: string) =>
  fit === "Strong" ? "Strong" : fit === "Skip" ? "Skip" : "look";

export function Board({ initial }: { initial: Target[] }) {
  const [targets, setTargets] = useState(initial);
  const [filter, setFilter] = useState("open");
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addingContact, setAddingContact] = useState(false);

  const replace = (t: Target) => setTargets((ts) => ts.map((x) => (x.slug === t.slug ? t : x)));

  async function quickStatus(slug: string, status: Status) {
    setTargets((ts) => ts.map((t) => (t.slug === slug ? { ...t, status } : t)));
    await fetch(`/api/targets/${slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
  }

  async function remove(slug: string) {
    await fetch(`/api/targets/${slug}`, { method: "DELETE" });
    setTargets((ts) => ts.filter((t) => t.slug !== slug));
    setOpenSlug(null);
  }

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("fit");
  const [view, setView] = useState<"list" | "sponsor">("list");

  const fitRank = (f?: string) => (f === "Strong" ? 0 : f === "Worth a look" ? 1 : f === "Skip" ? 2 : 3);
  // Group under the primary sponsor (strip parentheticals / co-investors after +·,(  ).
  const sponsorKey = (t: Target) => (t.sponsor || "").split(/[+·,(]/)[0].trim() || "No sponsor";

  const q = query.trim().toLowerCase();
  const filtered = targets.filter((t) => {
    if (q && !`${t.company} ${t.sponsor ?? ""}`.toLowerCase().includes(q)) return false;
    if (filter === "all") return true;
    if (filter === "open") return t.status !== "dead" && t.status !== "won";
    if (filter === "strong") return t.fit === "Strong";
    if (filter === "due") return !!t.follow_up || !!t.next_step;
    return t.status === filter;
  });

  const sorters: Record<string, (a: Target, b: Target) => number> = {
    fit: (a, b) => fitRank(a.fit) - fitRank(b.fit) || a.company.localeCompare(b.company),
    recent: (a, b) => (b.discovered_at ?? "").localeCompare(a.discovered_at ?? ""),
    followup: (a, b) => (a.follow_up || "9999-12-31").localeCompare(b.follow_up || "9999-12-31"),
    company: (a, b) => a.company.localeCompare(b.company),
  };
  const sorted = [...filtered].sort(sorters[sortKey]);

  const groups =
    view === "sponsor"
      ? Object.entries(
          sorted.reduce<Record<string, Target[]>>((acc, t) => {
            (acc[sponsorKey(t)] ??= []).push(t);
            return acc;
          }, {}),
        ).sort((a, b) => b[1].length - a[1].length)
      : null;

  const open = targets.find((t) => t.slug === openSlug) ?? null;
  const n = (pred: (t: Target) => boolean) => targets.filter(pred).length;

  const row = (t: Target) => (
    <tr key={t.slug} className="rowlink" onClick={() => setOpenSlug(t.slug)}>
      <td>
        <div className="company">
          {t.kind === "contact" ? (t.contact_name || t.company) : t.company}
          {t.kind === "contact" && <span className="pill accent">contact</span>}
          {t.manual && t.kind !== "contact" && <span className="pill">manual</span>}
          {t.dossier && <span className="pill">brief</span>}
        </div>
        <div className="sub">
          {t.kind === "contact"
            ? [t.contact_title, t.company].filter(Boolean).join(" · ")
            : [t.sponsor, t.hq].filter(Boolean).join(" · ")}
        </div>
      </td>
      <td>{t.fit && <span className={`badge ${fitClass(t.fit)}`}>{t.fit}</span>}</td>
      <td className="why">
        {t.next_step || <span className="muted">—</span>}
        {t.follow_up && <div className="sub">due {t.follow_up}</div>}
      </td>
      <td onClick={(e) => e.stopPropagation()}>
        <select data-status={t.status} value={t.status} onChange={(e) => quickStatus(t.slug, e.target.value as Status)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </td>
    </tr>
  );

  const table = (rows: Target[]) => (
    <table>
      <thead>
        <tr><th>Company</th><th>Fit</th><th>Next step</th><th>Status</th></tr>
      </thead>
      <tbody>{rows.map(row)}</tbody>
    </table>
  );

  return (
    <>
      <div className="stats">
        <span className="stat"><b>{targets.length}</b> total</span>
        <span className="stat strong"><b>{n((t) => t.fit === "Strong")}</b> strong</span>
        <span className="stat"><b>{n((t) => t.fit === "Worth a look")}</b> worth a look</span>
        <span className="sep" />
        {STATUSES.filter((s) => n((t) => t.status === s)).map((s) => (
          <span key={s} className="stat"><b>{n((t) => t.status === s)}</b> {s}</span>
        ))}
        <span className="sep" />
        <span className="stat"><b>{n((t) => !!t.dossier)}</b> researched</span>
      </div>

      <div className="toolbar">
        <div className="filters">
          {["open", "strong", "due", "all", ...STATUSES].map((f) => (
            <button key={f} className={filter === f ? "active" : ""} onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
        <div className="controls">
          <input className="search" placeholder="search company / sponsor" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select className="sortsel" value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
            <option value="fit">sort: fit</option>
            <option value="recent">sort: recent</option>
            <option value="followup">sort: follow-up</option>
            <option value="company">sort: A–Z</option>
          </select>
          <div className="viewtoggle">
            <button className={view === "list" ? "active" : ""} onClick={() => setView("list")}>list</button>
            <button className={view === "sponsor" ? "active" : ""} onClick={() => setView("sponsor")}>by sponsor</button>
          </div>
          <button className="add-btn ghost" onClick={() => setAddingContact(true)}>+ Contact</button>
          <button className="add-btn" onClick={() => setAdding(true)}>+ Company</button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="empty">No matches. The Radar posts new targets automatically.</div>
      ) : view === "sponsor" ? (
        <table>
          <thead>
            <tr><th>Company</th><th>Fit</th><th>Next step</th><th>Status</th></tr>
          </thead>
          {groups!.map(([name, rows]) => (
            <tbody key={name}>
              <tr className="group-row">
                <td colSpan={4}>
                  <span className="group-name">{name}</span>
                  <span className="count">{rows.length}</span>
                </td>
              </tr>
              {rows.map(row)}
            </tbody>
          ))}
        </table>
      ) : (
        table(sorted)
      )}

      {open && (
        <Drawer
          key={open.slug}
          target={open}
          onClose={() => setOpenSlug(null)}
          onSaved={replace}
          onDelete={() => remove(open.slug)}
        />
      )}
      {adding && (
        <AddForm
          onClose={() => setAdding(false)}
          onAdded={(t) => {
            setTargets((ts) => [t, ...ts.filter((x) => x.slug !== t.slug)]);
            setAdding(false);
          }}
        />
      )}
      {addingContact && (
        <ContactForm
          onClose={() => setAddingContact(false)}
          onAdded={(t) => {
            setTargets((ts) => [t, ...ts.filter((x) => x.slug !== t.slug)]);
            setAddingContact(false);
            setOpenSlug(t.slug); // open it so you can draft the note right away
          }}
        />
      )}
    </>
  );
}

function Drawer({
  target,
  onClose,
  onSaved,
  onDelete,
}: {
  target: Target;
  onClose: () => void;
  onSaved: (t: Target) => void;
  onDelete: () => void;
}) {
  const [status, setStatus] = useState<Status>(target.status);
  const [notes, setNotes] = useState(target.notes ?? "");
  const [nextStep, setNextStep] = useState(target.next_step ?? "");
  const [followUp, setFollowUp] = useState(target.follow_up ?? "");
  const [outreach, setOutreach] = useState(target.outreach ?? "");
  const [linkedinNote, setLinkedinNote] = useState(target.linkedin_note ?? "");
  const [dossier, setDossier] = useState(target.dossier ?? "");
  const [dstatus, setDstatus] = useState<string>(target.dossier_status ?? "none");
  const [drafting, setDrafting] = useState(false);
  const [draftingLi, setDraftingLi] = useState(false);
  const [saved, setSaved] = useState(false);

  // Every edit auto-saves as a field-scoped PATCH — no Save button, and nothing
  // clobbers values that arrive asynchronously (dossier / outreach / status).
  async function patch(fields: Partial<Target>) {
    const res = await fetch(`/api/targets/${target.slug}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (res.ok) {
      onSaved(await res.json());
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    }
  }

  // Poll while a dossier run is in flight. Resumes if reopened after navigating away.
  useEffect(() => {
    if (dstatus !== "running") return;
    const id = setInterval(async () => {
      const res = await fetch(`/api/targets/${target.slug}/research`);
      if (!res.ok) return;
      const d = await res.json();
      if (d.status === "done") {
        setDossier(d.dossier ?? "");
        setDstatus("done");
        onSaved({ ...target, dossier: d.dossier, dossier_status: "done", people: d.people });
      } else if (d.status === "error") {
        setDstatus("error");
      }
    }, 5000);
    return () => clearInterval(id);
  }, [dstatus, target, onSaved]);

  async function research() {
    setDstatus("running");
    onSaved({ ...target, dossier_status: "running" }); // persist to the list immediately
    const res = await fetch(`/api/targets/${target.slug}/research`, { method: "POST" });
    if (!res.ok) {
      setDstatus("error");
      alert("Research failed: " + ((await res.json().catch(() => ({}))).error ?? res.status));
    }
  }

  async function draftOutreach() {
    setDrafting(true);
    const res = await fetch(`/api/targets/${target.slug}/outreach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "email" }),
    });
    if (res.ok) {
      const d = await res.json();
      setOutreach(d.text);
      onSaved({ ...target, outreach: d.text });
    } else {
      alert("Draft failed: " + ((await res.json().catch(() => ({}))).error ?? res.status));
    }
    setDrafting(false);
  }

  async function draftLinkedIn() {
    setDraftingLi(true);
    const res = await fetch(`/api/targets/${target.slug}/outreach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "linkedin" }),
    });
    if (res.ok) {
      const d = await res.json();
      setLinkedinNote(d.text);
      onSaved({ ...target, linkedin_note: d.text });
    } else {
      alert("LinkedIn draft failed: " + ((await res.json().catch(() => ({}))).error ?? res.status));
    }
    setDraftingLi(false);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <div>
            <h2>{target.kind === "contact" ? (target.contact_name || target.company) : target.company}</h2>
            <div className="sub">
              {target.kind === "contact"
                ? [target.contact_title, target.company].filter(Boolean).join(" · ")
                : [target.sponsor, target.hq, target.vertical].filter(Boolean).join(" · ")}
              {saved && <span className="saved"> · saved ✓</span>}
            </div>
          </div>
          {target.fit && <span className={`badge ${fitClass(target.fit)}`}>{target.fit}</span>}
        </div>

        {target.why_now && (
          <section><h3>Why now</h3><p>{target.why_now}</p></section>
        )}
        {target.green_signals?.length ? (
          <section><h3>Signals</h3><div>{target.green_signals.map((g, i) => <span className="tag" key={i}>{g}</span>)}</div></section>
        ) : null}
        {target.entry_persona && (
          <section><h3>Entry</h3><p>{target.entry_persona}</p></section>
        )}
        {target.people?.length ? (
          <section>
            <h3>Key people</h3>
            <table className="people">
              <tbody>
                {target.people.map((p, i) => (
                  <tr key={i}>
                    <td className="pname">
                      {p.name}
                      {p.linkedin && (
                        <> · <a href={p.linkedin} target="_blank" rel="noreferrer">in↗</a></>
                      )}
                    </td>
                    <td className="sub">{[p.title, p.persona].filter(Boolean).join(" · ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
        {target.sources?.length ? (
          <section><h3>Sources</h3><ul className="srcs">{target.sources.map((s, i) => <li key={i}><a href={s} target="_blank" rel="noreferrer">{s}</a></li>)}</ul></section>
        ) : null}

        <div className="edit">
          <label>Status
            <select data-status={status} value={status} onChange={(e) => { const v = e.target.value as Status; setStatus(v); patch({ status: v }); }}>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Next step
            <input value={nextStep} onChange={(e) => setNextStep(e.target.value)} onBlur={() => patch({ next_step: nextStep })} placeholder="e.g. warm intro via the sponsor" />
          </label>
          <label>Follow-up
            <input type="date" value={followUp} onChange={(e) => { setFollowUp(e.target.value); patch({ follow_up: e.target.value }); }} />
          </label>
          <label>Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => patch({ notes })} rows={6} placeholder="call notes, context…" />
          </label>
          <label>
            <span className="field-head">
              Outreach draft
              <span className="field-actions">
                <button type="button" className="mini" onClick={draftOutreach} disabled={drafting}>
                  {drafting ? "drafting…" : outreach ? "regenerate" : "draft outreach"}
                </button>
                {outreach && (
                  <button type="button" className="mini" onClick={() => navigator.clipboard.writeText(outreach)}>copy</button>
                )}
              </span>
            </span>
            <textarea
              value={outreach}
              onChange={(e) => setOutreach(e.target.value)}
              onBlur={() => patch({ outreach })}
              rows={9}
              placeholder="click 'draft outreach' — a first-touch in your voice, from this card. edit before sending."
            />
          </label>
          <label>
            <span className="field-head">
              LinkedIn note
              <span className="field-actions">
                <button type="button" className="mini" onClick={draftLinkedIn} disabled={draftingLi}>
                  {draftingLi ? "drafting…" : linkedinNote ? "regenerate" : "draft LinkedIn note"}
                </button>
                {linkedinNote && (
                  <button type="button" className="mini" onClick={() => navigator.clipboard.writeText(linkedinNote)}>copy</button>
                )}
              </span>
            </span>
            <textarea
              value={linkedinNote}
              onChange={(e) => setLinkedinNote(e.target.value)}
              onBlur={() => patch({ linkedin_note: linkedinNote })}
              rows={4}
              maxLength={400}
              placeholder="~300-char connect note / short DM. for a sponsor's partner it pitches the portfolio pattern and cites their portcos."
            />
            <div className="charcount">{linkedinNote.length}/300</div>
          </label>
          <label>
            <span className="field-head">
              Deep research
              <span className="field-actions">
                <button type="button" className="mini" onClick={research} disabled={dstatus === "running"}>
                  {dstatus === "running" ? "researching…" : dossier ? "re-research" : "deep research"}
                </button>
                {dossier && (
                  <button type="button" className="mini" onClick={() => navigator.clipboard.writeText(dossier)}>copy</button>
                )}
              </span>
            </span>
            {dstatus === "running" && (
              <div className="hint">Running the dossier agent — a few minutes. Safe to close; it'll attach when you reopen.</div>
            )}
            {dstatus === "error" && <div className="hint err">Research errored — try again.</div>}
            <textarea
              value={dossier}
              onChange={(e) => setDossier(e.target.value)}
              onBlur={() => patch({ dossier })}
              rows={14}
              placeholder="click 'deep research' — the dossier agent researches this target and attaches a full pre-call brief here."
            />
          </label>
        </div>

        <div className="drawer-foot">
          <button className="del" onClick={onDelete}>Delete</button>
          <button onClick={onClose}>Close</button>
        </div>
      </aside>
    </div>
  );
}

function AddForm({ onClose, onAdded }: { onClose: () => void; onAdded: (t: Target) => void }) {
  const [f, setF] = useState({ company: "", sponsor: "", hq: "", vertical: "", fit: "Worth a look", why_now: "", entry_persona: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));

  async function add() {
    if (!f.company.trim()) return;
    setSaving(true);
    const res = await fetch("/api/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(f),
    });
    if (res.ok) onAdded(await res.json());
    else setSaving(false);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><h2>Add target</h2></div>
        <div className="edit">
          <label>Company*<input value={f.company} onChange={(e) => set("company", e.target.value)} autoFocus /></label>
          <label>Sponsor<input value={f.sponsor} onChange={(e) => set("sponsor", e.target.value)} /></label>
          <label>HQ<input value={f.hq} onChange={(e) => set("hq", e.target.value)} /></label>
          <label>Vertical<input value={f.vertical} onChange={(e) => set("vertical", e.target.value)} /></label>
          <label>Fit
            <select value={f.fit} onChange={(e) => set("fit", e.target.value)}>
              <option>Strong</option><option>Worth a look</option><option>Skip</option>
            </select>
          </label>
          <label>Why now<textarea value={f.why_now} onChange={(e) => set("why_now", e.target.value)} rows={3} /></label>
          <label>Entry persona<input value={f.entry_persona} onChange={(e) => set("entry_persona", e.target.value)} /></label>
        </div>
        <div className="drawer-foot">
          <span />
          <div>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={add} disabled={saving || !f.company.trim()}>{saving ? "Adding…" : "Add"}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function ContactForm({ onClose, onAdded }: { onClose: () => void; onAdded: (t: Target) => void }) {
  const [f, setF] = useState({ contact_name: "", contact_title: "", company: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const ready = f.contact_name.trim() && f.company.trim();

  async function add() {
    if (!ready) return;
    setSaving(true);
    const res = await fetch("/api/manual", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind: "contact",
        contact_name: f.contact_name,
        contact_title: f.contact_title,
        company: f.company,
        sponsor: f.company, // groups under the org; triggers the portfolio pitch if it has portcos
      }),
    });
    if (res.ok) onAdded(await res.json());
    else setSaving(false);
  }

  return (
    <div className="overlay" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head"><h2>Add contact</h2></div>
        <p className="sub" style={{ margin: "0 0 16px" }}>
          A person to reach out to — e.g. a PE operating partner. If their org has portcos in your CRM,
          the outreach pitches the portfolio pattern and cites them by name.
        </p>
        <div className="edit">
          <label>Name*<input value={f.contact_name} onChange={(e) => set("contact_name", e.target.value)} autoFocus placeholder="Billy Hart" /></label>
          <label>Title<input value={f.contact_title} onChange={(e) => set("contact_title", e.target.value)} placeholder="Managing Partner" /></label>
          <label>Organization / fund*<input value={f.company} onChange={(e) => set("company", e.target.value)} placeholder="Example Capital" /></label>
        </div>
        <div className="drawer-foot">
          <span />
          <div>
            <button onClick={onClose}>Cancel</button>
            <button className="primary" onClick={add} disabled={saving || !ready}>{saving ? "Adding…" : "Add contact"}</button>
          </div>
        </div>
      </aside>
    </div>
  );
}
