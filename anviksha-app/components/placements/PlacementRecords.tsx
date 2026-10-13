"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Briefcase, Download, FileSpreadsheet, GraduationCap, Pencil, Plus, Search, Trash2, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";

type Offer = { id: number; usn: string; name: string; batch: string; company: string; role: string | null; package_lpa: number | null; offer_type: string | null; status: string | null; offer_date: string | null; drive_type: string | null };
type Internship = { id: number; usn: string; name: string; batch: string; company: string; role: string | null; stipend_per_month: number | null; start_date: string | null; end_date: string | null; status: string | null; mode: string | null };
type Records = { placements: Offer[]; internships: Internship[]; companies: string[]; batches: string[]; offer_types: string[]; statuses: string[] };
type Kind = "placements" | "internships";
type ImportRow = { name: string; company: string; amount: string; decision: string; matched_usn: string | null; matched_name: string | null; how: string | null; reason: string | null; candidates: { usn: string; name: string }[] };
type ImportResult = { applied: boolean; written: { placements: number; internships: number }; placements: ImportRow[]; internships: ImportRow[] };

const INPUT = "w-full border border-gray-200 bg-white rounded-xl px-3.5 min-h-[44px] text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30";
const DRIVE_TYPES = ["Not specified", "campus", "off-campus", "pool"];
const DECISION: Record<string, { label: string; tone: "success" | "warning" | "danger" | "neutral" }> = {
  import: { label: "Will be saved", tone: "success" },
  ambiguous: { label: "Not sure which student", tone: "warning" },
  unmatched: { label: "No matching student", tone: "danger" },
  invalid: { label: "Problem in the row", tone: "danger" },
  held: { label: "Held: source needs confirming", tone: "warning" },
};
const batchWord = (b: string) => (/^\d{4}$/.test(b) ? `${b}–${Number(b) + 4}` : b);
const blankOffer = { usn: "", company: "", role: "", package_lpa: "", offer_type: "full-time", status: "offered", offer_date: "", drive_type: "Not specified" };
const blankIntern = { usn: "", company: "", role: "", stipend_per_month: "", start_date: "", end_date: "", status: "", mode: "" };

/**
 * Add, correct and remove placement offers and internships. The admin sees
 * every department and can import from CSV; an HOD sees their own department.
 */
export function PlacementRecords({ role }: { role: "admin" | "hod" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const batch = params.get("batch") || "";
  const kind: Kind = params.get("view") === "internships" ? "internships" : "placements";
  const letter = role === "admin" ? "A" : "H";
  const { push } = useToast();

  const [data, setData] = useState<Records | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState<{ kind: Kind; id: number | null; values: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<{ kind: Kind; id: number; label: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [files, setFiles] = useState<{ placements: File | null; internships: File | null }>({ placements: null, internships: null });
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) { if (v) next.set(k, v); else next.delete(k); }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  };

  const load = () => {
    setFailed(false);
    api.placementRecords(batch || undefined).then(setData).catch(() => setFailed(true));
  };
  useEffect(load, [batch]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEdit = (k: Kind, row: any) => setForm({
    kind: k, id: row.id,
    values: k === "placements"
      ? { usn: row.usn, company: row.company || "", role: row.role || "", package_lpa: row.package_lpa != null ? String(row.package_lpa) : "", offer_type: row.offer_type || "full-time", status: row.status || "offered", offer_date: row.offer_date || "", drive_type: row.drive_type || "Not specified" }
      : { usn: row.usn, company: row.company || "", role: row.role || "", stipend_per_month: row.stipend_per_month != null ? String(row.stipend_per_month) : "", start_date: row.start_date || "", end_date: row.end_date || "", status: row.status || "", mode: row.mode || "" },
  });

  const save = async () => {
    if (!form || saving) return;
    const v = form.values;
    if (!v.usn.trim() || !v.company.trim()) { push("USN and company are required.", "error"); return; }
    const payload: Record<string, unknown> = form.kind === "placements"
      ? { company: v.company, role: v.role, package_lpa: Number(v.package_lpa), offer_type: v.offer_type, status: v.status, offer_date: v.offer_date || null, drive_type: v.drive_type }
      : { company: v.company, role: v.role, stipend_per_month: v.stipend_per_month ? Number(v.stipend_per_month) : null, start_date: v.start_date || null, end_date: v.end_date || null, status: v.status || null, mode: v.mode };
    if (form.kind === "placements" && !(Number(v.package_lpa) > 0)) { push("Enter the package in LPA, for example 6.5.", "error"); return; }
    if (!form.id) payload.usn = v.usn;
    setSaving(true);
    try {
      await api.savePlacementRecord(form.kind, form.id, payload);
      push(form.id ? "Record updated" : form.kind === "placements" ? "Offer added. It now shows on the student's profile and the placement wall." : "Internship added");
      setForm(null);
      load();
    } catch (e: any) {
      push(e?.detail || "Could not save the record.", "error");
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!toDelete) return;
    try { await api.deletePlacementRecord(toDelete.kind, toDelete.id); push("Record deleted"); setToDelete(null); load(); }
    catch (e: any) { push(e?.detail || "Could not delete the record.", "error"); }
  };

  const runImport = async (apply: boolean) => {
    if (importBusy || (!files.placements && !files.internships)) return;
    setImportBusy(true);
    try {
      const res: ImportResult = await api.importPlacementRecords(files, apply);
      setImportResult(res);
      if (apply) { push(`Saved ${res.written.placements} offer(s) and ${res.written.internships} internship(s).`); load(); }
    } catch (e: any) {
      push(e?.detail || "That file could not be read.", "error");
    }
    setImportBusy(false);
  };

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list: any[] = data ? data[kind] : [];
    return needle ? list.filter((r) => `${r.usn} ${r.name} ${r.company}`.toLowerCase().includes(needle)) : list;
  }, [data, kind, query]);

  const exportRows = () => {
    if (kind === "placements") downloadCsv(`placements${batch ? `_${batch}` : ""}`, ["USN", "Name", "Batch", "Company", "Role", "Package (LPA)", "Offer type", "Status", "Offer date", "Drive"], (rows as Offer[]).map((r) => [r.usn, r.name, r.batch, r.company, r.role, r.package_lpa, r.offer_type, r.status, r.offer_date, r.drive_type]));
    else downloadCsv(`internships${batch ? `_${batch}` : ""}`, ["USN", "Name", "Batch", "Company", "Role", "Stipend per month", "Start", "End", "Status", "Mode"], (rows as Internship[]).map((r) => [r.usn, r.name, r.batch, r.company, r.role, r.stipend_per_month, r.start_date, r.end_date, r.status, r.mode]));
  };

  const title = "Placement Records";
  if (failed) return <><Topbar greeting={title} subtitle="Offers and internships" avatarLetter={letter} /><LoadError message="We couldn't load the placement records." onRetry={load} /></>;
  if (!data) return <><Topbar greeting={title} subtitle="Loading…" avatarLetter={letter} /><DashboardSkeleton /></>;

  const set = (key: string, value: string) => form && setForm({ ...form, values: { ...form.values, [key]: value } });
  const previewRows = importResult ? [...importResult.placements.map((r) => ({ ...r, kind: "Offer" })), ...importResult.internships.map((r) => ({ ...r, kind: "Internship" }))] : [];
  const willSave = previewRows.filter((r) => r.decision === "import").length;

  return (
    <>
      <Topbar greeting={title} subtitle={`Dashboard > ${title}`} avatarLetter={letter} />
      <div className="p-4 md:p-8 space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <div role="tablist" aria-label="Record type" className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {([["placements", `Offers (${data.placements.length})`], ["internships", `Internships (${data.internships.length})`]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={kind === k} onClick={() => setParam({ view: k === "placements" ? null : k })} className={`px-3 min-h-[40px] rounded-lg text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${kind === k ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{label}</button>
            ))}
          </div>
          <select aria-label="Batch" value={batch} onChange={(e) => setParam({ batch: e.target.value || null })} className="border border-gray-200 bg-white rounded-xl px-3 min-h-[44px] text-sm text-ink outline-none">
            <option value="">All batches</option>
            {data.batches.map((b) => <option key={b} value={b}>{batchWord(b)}</option>)}
          </select>
          <label className="relative flex-1 min-w-[12rem] max-w-sm">
            <span className="sr-only">Search records</span>
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search student or company" className={`${INPUT} pl-10`} />
          </label>
          <div className="flex gap-2 ml-auto flex-wrap">
            <Button variant="secondary" className="min-h-[44px]" disabled={rows.length === 0} onClick={exportRows}><Download size={14} /> Export</Button>
            {role === "admin" && <Button variant="secondary" className="min-h-[44px]" onClick={() => { setImporting(true); setImportResult(null); setFiles({ placements: null, internships: null }); }}><Upload size={14} /> Import CSV</Button>}
            <Button className="min-h-[44px]" onClick={() => setForm({ kind, id: null, values: kind === "placements" ? { ...blankOffer } : { ...blankIntern } })}><Plus size={15} /> Add {kind === "placements" ? "offer" : "internship"}</Button>
          </div>
        </div>

        <Card className="!p-0 overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              icon={kind === "placements" ? Briefcase : GraduationCap}
              title={query ? "No record matches your search" : kind === "placements" ? "No offers recorded yet" : "No internships recorded yet"}
              hint={query ? undefined : "Records added here appear at once on the student's dashboard, profile and resume, and in the placement analytics."}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-gray-100">
                    <th className="py-3 pl-5 pr-3 font-medium">Student</th>
                    <th className="py-3 pr-3 font-medium">Company</th>
                    <th className="py-3 pr-3 font-medium">{kind === "placements" ? "Package" : "Stipend"}</th>
                    <th className="py-3 pr-3 font-medium">{kind === "placements" ? "Type" : "Dates"}</th>
                    <th className="py-3 pr-3 font-medium">Status</th>
                    <th className="py-3 pr-5 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r: any) => (
                    <tr key={r.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-2.5 pl-5 pr-3"><div className="font-medium text-ink">{r.name}</div><div className="text-xs text-muted">{r.usn} · {batchWord(r.batch)}</div></td>
                      <td className="py-2.5 pr-3 text-ink">{r.company}{r.role && <div className="text-xs text-muted">{r.role}</div>}</td>
                      <td className="py-2.5 pr-3 font-semibold text-ink numeric whitespace-nowrap">
                        {kind === "placements" ? (r.package_lpa != null ? `${r.package_lpa} LPA` : "—") : r.stipend_per_month != null ? `₹${Number(r.stipend_per_month).toLocaleString("en-IN")}/mo` : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-ink">
                        {kind === "placements" ? <>{r.offer_type || "—"}<div className="text-xs text-muted">{r.drive_type || "Not specified"}</div></> : <span className="text-xs">{[r.start_date, r.end_date].filter(Boolean).join(" → ") || "—"}</span>}
                      </td>
                      <td className="py-2.5 pr-3">{r.status ? <Badge tone={r.status === "declined" ? "neutral" : r.status === "ongoing" ? "info" : "success"}>{r.status}</Badge> : <span className="text-muted">—</span>}</td>
                      <td className="py-2.5 pr-5">
                        <div className="flex justify-end gap-1">
                          <button aria-label={`Edit ${r.name} at ${r.company}`} onClick={() => openEdit(kind, r)} className="w-11 h-11 rounded-xl text-muted hover:text-brand hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Pencil size={15} /></button>
                          <button aria-label={`Delete ${r.name} at ${r.company}`} onClick={() => setToDelete({ kind, id: r.id, label: `${r.name} — ${r.company}` })} className="w-11 h-11 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Trash2 size={15} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <CenterModal open={!!form} onClose={() => !saving && setForm(null)} title={form ? `${form.id ? "Edit" : "Add"} ${form.kind === "placements" ? "offer" : "internship"}` : ""}>
        {form && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="pr-usn" className="text-xs font-medium text-muted mb-1 block">Student USN</label>
                <input id="pr-usn" value={form.values.usn} disabled={!!form.id} onChange={(e) => set("usn", e.target.value.toUpperCase())} placeholder="4GW23IS001" className={`${INPUT} disabled:opacity-60`} />
              </div>
              <div>
                <label htmlFor="pr-company" className="text-xs font-medium text-muted mb-1 block">Company</label>
                <input id="pr-company" list="pr-companies" value={form.values.company} onChange={(e) => set("company", e.target.value)} className={INPUT} />
                <datalist id="pr-companies">{data.companies.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div>
              <label htmlFor="pr-role" className="text-xs font-medium text-muted mb-1 block">Role <span className="font-normal">(optional)</span></label>
              <input id="pr-role" value={form.values.role} onChange={(e) => set("role", e.target.value)} placeholder="e.g. Software Engineer" className={INPUT} />
            </div>
            {form.kind === "placements" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pr-pkg" className="text-xs font-medium text-muted mb-1 block">Package (LPA)</label>
                    <input id="pr-pkg" type="number" inputMode="decimal" min="0" step="0.01" value={form.values.package_lpa} onChange={(e) => set("package_lpa", e.target.value)} placeholder="6.5" className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="pr-date" className="text-xs font-medium text-muted mb-1 block">Offer date <span className="font-normal">(optional)</span></label>
                    <input id="pr-date" type="date" value={form.values.offer_date} onChange={(e) => set("offer_date", e.target.value)} className={INPUT} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label htmlFor="pr-type" className="text-xs font-medium text-muted mb-1 block">Offer type</label>
                    <select id="pr-type" value={form.values.offer_type} onChange={(e) => set("offer_type", e.target.value)} className={INPUT}>{data.offer_types.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  </div>
                  <div>
                    <label htmlFor="pr-status" className="text-xs font-medium text-muted mb-1 block">Status</label>
                    <select id="pr-status" value={form.values.status} onChange={(e) => set("status", e.target.value)} className={INPUT}>{data.statuses.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  </div>
                  <div>
                    <label htmlFor="pr-drive" className="text-xs font-medium text-muted mb-1 block">Drive</label>
                    <select id="pr-drive" value={form.values.drive_type} onChange={(e) => set("drive_type", e.target.value)} className={INPUT}>{DRIVE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pr-stipend" className="text-xs font-medium text-muted mb-1 block">Stipend per month (₹) <span className="font-normal">(optional)</span></label>
                    <input id="pr-stipend" type="number" inputMode="numeric" min="0" value={form.values.stipend_per_month} onChange={(e) => set("stipend_per_month", e.target.value)} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="pr-istatus" className="text-xs font-medium text-muted mb-1 block">Status</label>
                    <select id="pr-istatus" value={form.values.status} onChange={(e) => set("status", e.target.value)} className={INPUT}><option value="">Not recorded</option><option value="ongoing">ongoing</option><option value="completed">completed</option></select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pr-start" className="text-xs font-medium text-muted mb-1 block">Start date</label>
                    <input id="pr-start" type="date" value={form.values.start_date} onChange={(e) => set("start_date", e.target.value)} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="pr-end" className="text-xs font-medium text-muted mb-1 block">End date</label>
                    <input id="pr-end" type="date" value={form.values.end_date} onChange={(e) => set("end_date", e.target.value)} className={INPUT} />
                  </div>
                </div>
              </>
            )}
            <Button className="w-full min-h-[44px]" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        )}
      </CenterModal>

      <CenterModal open={!!toDelete} onClose={() => setToDelete(null)} title="Delete this record?" width="max-w-sm">
        <p className="text-sm text-muted mb-5">{toDelete?.label}. It will disappear from the student's profile and from the analytics. This can't be undone.</p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1 min-h-[44px]" onClick={() => setToDelete(null)}>Cancel</Button>
          <Button variant="danger" className="flex-1 min-h-[44px]" onClick={remove}>Delete</Button>
        </div>
      </CenterModal>

      <CenterModal open={importing} onClose={() => !importBusy && setImporting(false)} title="Import from CSV" width="max-w-3xl">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Each row is matched to a student by USN, or by full name within the batch. A row is saved only when exactly one student matches —
            anything uncertain is listed for you to fix, never guessed.
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            {(["placements", "internships"] as const).map((k) => (
              <div key={k}>
                <input id={`imp-${k}`} type="file" accept=".csv" className="sr-only" onChange={(e) => { setFiles({ ...files, [k]: e.target.files?.[0] || null }); setImportResult(null); }} />
                <label htmlFor={`imp-${k}`} className="flex items-center gap-3 min-h-[64px] rounded-xl border-2 border-dashed border-gray-200 hover:border-brand/50 hover:bg-brand-50 cursor-pointer p-3 transition-colors">
                  <FileSpreadsheet size={20} className="text-brand shrink-0" />
                  <span className="min-w-0"><span className="block text-sm font-medium text-ink">{k === "placements" ? "Offers file" : "Internships file"}</span><span className="block text-xs text-muted truncate">{files[k]?.name || "Choose a .csv file"}</span></span>
                </label>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => downloadCsv("offers_template", ["name", "usn", "company", "package_lpa", "role", "offer_type", "offer_date", "status", "drive_type", "drive_date", "venue", "batch", "source_note", "needs_confirmation"], [["Student Name", "4GW23IS001", "Company", "6.5", "", "full-time", "", "offered", "campus", "", "", "2023", "", ""]])}><Download size={14} /> Offers template</Button>
            <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => downloadCsv("internships_template", ["name", "usn", "company", "stipend_per_month", "role", "start_date", "end_date", "status", "mode", "batch", "source_note", "needs_confirmation"], [["Student Name", "4GW23IS001", "Company", "25000", "", "2026-01-15", "2026-06-15", "ongoing", "", "2023", "", ""]])}><Download size={14} /> Internships template</Button>
            <Button className="min-h-[44px] ml-auto" disabled={importBusy || (!files.placements && !files.internships)} onClick={() => runImport(false)}>{importBusy ? "Working…" : "Check the files"}</Button>
          </div>
          <p className="text-xs text-muted">The batch column is the entry year stored for the student (2023 for the 2023–2027 batch).</p>

          {importResult && (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                <div className="text-sm font-semibold text-ink">
                  {importResult.applied ? `Saved ${importResult.written.placements} offer(s) and ${importResult.written.internships} internship(s)` : `${willSave} of ${previewRows.length} rows will be saved`}
                </div>
                {!importResult.applied && <Button className="min-h-[44px]" disabled={importBusy || willSave === 0} onClick={() => runImport(true)}>Save {willSave} row{willSave === 1 ? "" : "s"}</Button>}
              </div>
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="w-full text-sm min-w-[620px]">
                  <thead><tr className="text-left text-xs text-muted border-b border-gray-100"><th className="py-2 pl-3 pr-3 font-medium">Row</th><th className="py-2 pr-3 font-medium">Matched student</th><th className="py-2 pr-3 font-medium">Result</th></tr></thead>
                  <tbody>
                    {previewRows.map((r, i) => {
                      const d = DECISION[r.decision] || { label: r.decision, tone: "neutral" as const };
                      return (
                        <tr key={i} className="border-b border-gray-100 last:border-0 align-top">
                          <td className="py-2 pl-3 pr-3"><div className="font-medium text-ink">{r.name}</div><div className="text-xs text-muted">{r.kind} · {r.company}{r.amount ? ` · ${r.amount}` : ""}</div></td>
                          <td className="py-2 pr-3 text-ink">{r.matched_usn ? <>{r.matched_usn}<div className="text-xs text-muted">{r.matched_name}</div></> : r.candidates.length ? <span className="text-xs text-muted">Could be: {r.candidates.map((c) => `${c.name} (${c.usn})`).join(", ")}</span> : "—"}</td>
                          <td className="py-2 pr-3"><Badge tone={d.tone}>{d.label}</Badge>{r.decision !== "import" && r.reason && <div className="text-xs text-muted mt-1 max-w-xs">{r.reason}</div>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </CenterModal>
    </>
  );
}
