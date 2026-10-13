"use client";

import { useEffect, useState } from "react";
import { Download, FileText, Plus, Presentation, Trash2, Upload } from "lucide-react";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api, saveFile } from "@/lib/api";
import { FormatSummary, INPUT, PagePreview } from "@/components/projects/shared";

type Format = { id: number; kind: "report" | "ppt"; scope: string; name: string; project_type: string | null; batch: string | null; filename: string; active: boolean; uploaded: string | null; can_edit: boolean; warnings?: number };
type Detail = Format & { analysis: any; field_map: { match: string; field: string }[]; fields: { key: string; label: string }[]; preview_available: boolean };

/** Upload form for one format file. Used by HOD/admin for official formats and by a student for their own. */
export function FormatUpload({ kind: fixedKind, projectTypes, onDone, departments }: {
  kind?: "report" | "ppt"; projectTypes: string[]; onDone: (f: Detail) => void; departments?: { id: number; name: string }[];
}) {
  const { push } = useToast();
  const [kind, setKind] = useState<"report" | "ppt">(fixedKind || "report");
  const [name, setName] = useState("");
  const [projectType, setProjectType] = useState("");
  const [batch, setBatch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ext = kind === "report" ? ".docx" : ".pptx";

  const submit = async () => {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const made = await api.uploadProjectFormat(file, { kind, name: name.trim() || file.name.replace(/\.[^.]+$/, ""), project_type: projectType, batch, department_id: departmentId });
      push("Format uploaded and read.");
      onDone(made);
    } catch (e: any) {
      setError(e?.detail || "The file could not be uploaded. Please try again.");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-3">
      {!fixedKind && (
        <fieldset>
          <legend className="text-xs font-medium text-muted mb-1">This file is the format for</legend>
          <div className="grid grid-cols-2 gap-2">
            {([["report", "The report (.docx)"], ["ppt", "The presentation (.pptx)"]] as const).map(([k, label]) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => { setKind(k); setFile(null); }} className={`min-h-[44px] rounded-xl text-sm font-semibold border-2 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${kind === k ? "border-brand bg-brand-light text-brand" : "border-gray-100 text-muted"}`}>{label}</button>
            ))}
          </div>
        </fieldset>
      )}
      <div>
        <input id={`fmt-file-${kind}`} type="file" accept={ext} className="sr-only" onChange={(e) => { setFile(e.target.files?.[0] || null); setError(""); }} />
        <label htmlFor={`fmt-file-${kind}`} className="flex items-center gap-3 min-h-[64px] rounded-xl border-2 border-dashed border-gray-200 hover:border-brand/50 hover:bg-brand-50 cursor-pointer p-3 transition-colors">
          <Upload size={20} className="text-brand shrink-0" />
          <span className="min-w-0"><span className="block text-sm font-medium text-ink break-all">{file ? file.name : `Choose the ${ext} file`}</span><span className="block text-xs text-muted">Up to 25 MB. Older .doc / .ppt files must be saved as {ext} first.</span></span>
        </label>
      </div>
      <div>
        <label htmlFor="fmt-name" className="text-xs font-medium text-muted mb-1 block">Name students will see</label>
        <input id="fmt-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={kind === "report" ? "e.g. Final year project report 2025-26" : "e.g. Final year project presentation 2025-26"} className={INPUT} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="fmt-type" className="text-xs font-medium text-muted mb-1 block">Project type <span className="font-normal">(optional)</span></label>
          <select id="fmt-type" value={projectType} onChange={(e) => setProjectType(e.target.value)} className={INPUT}>
            <option value="">Any</option>
            {projectTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="fmt-batch" className="text-xs font-medium text-muted mb-1 block">Batch <span className="font-normal">(optional)</span></label>
          <input id="fmt-batch" value={batch} inputMode="numeric" maxLength={4} onChange={(e) => setBatch(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 2023" className={INPUT} />
        </div>
      </div>
      {departments && departments.length > 1 && (
        <div>
          <label htmlFor="fmt-dept" className="text-xs font-medium text-muted mb-1 block">Department</label>
          <select id="fmt-dept" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={INPUT}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button className="w-full min-h-[44px]" disabled={!file || busy} onClick={submit}>{busy ? "Reading the file…" : "Upload and read the format"}</Button>
    </div>
  );
}

/** One format in full: what was read from it, its preview, and which wording stands for which field. */
export function FormatDetail({ id, onChanged }: { id: number; onChanged?: () => void }) {
  const { push } = useToast();
  const [f, setF] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [map, setMap] = useState<{ match: string; field: string }[]>([]);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"summary" | "fields" | "preview">("summary");

  const load = () => {
    setFailed(false);
    api.projectFormat(id).then((d: Detail) => { setF(d); setMap(d.field_map); setDirty(false); }).catch(() => setFailed(true));
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (failed) return <LoadError message="We couldn't load this format." onRetry={load} compact />;
  if (!f) return <p className="text-sm text-muted py-6 text-center">Loading…</p>;

  const saveMap = async () => {
    try {
      const d: Detail = await api.editProjectFormat(f.id, { field_map: map.filter((m) => m.match.trim()) });
      setF(d); setMap(d.field_map); setDirty(false);
      push("Saved. New reports will use this.");
      onChanged?.();
    } catch (e: any) { push(e?.detail || "Could not save.", "error"); }
  };
  const change = (i: number, patch: Partial<{ match: string; field: string }>) => { setMap(map.map((m, j) => (j === i ? { ...m, ...patch } : m))); setDirty(true); };

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Format details" className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {([["summary", "What was read"], ["fields", `Fill-in fields (${map.length})`], ["preview", "Preview"]] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 min-h-[40px] rounded-lg text-xs font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${tab === k ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{label}</button>
        ))}
      </div>
      {tab === "summary" && <FormatSummary analysis={f.analysis} />}
      {tab === "fields" && (
        <div className="space-y-3">
          <p className="text-sm text-muted">
            These are the words in the format that get replaced with each project's details. Check them once: if a line is wrong, change what it stands for;
            if the format has a field that is not listed, add its exact wording.
          </p>
          {map.length === 0 && <p className="text-sm text-ink">No fill-in wording was recognised in this format. Add the exact wording of each field below (for example the sample title on the cover page).</p>}
          <ul className="space-y-2">
            {map.map((m, i) => (
              <li key={i} className="grid sm:grid-cols-[1fr_15rem_auto] gap-2 items-center">
                <input aria-label="Wording in the format" value={m.match} disabled={!f.can_edit} onChange={(e) => change(i, { match: e.target.value })} className={INPUT} />
                <select aria-label={`What "${m.match}" stands for`} value={m.field} disabled={!f.can_edit} onChange={(e) => change(i, { field: e.target.value })} className={INPUT}>
                  {f.fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
                </select>
                {f.can_edit && <button aria-label={`Remove ${m.match}`} onClick={() => { setMap(map.filter((_, j) => j !== i)); setDirty(true); }} className="w-11 h-11 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center"><Trash2 size={15} /></button>}
              </li>
            ))}
          </ul>
          {f.can_edit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" className="min-h-[44px]" onClick={() => { setMap([...map, { match: "", field: "title" }]); setDirty(true); }}><Plus size={14} /> Add a field</Button>
              <Button className="min-h-[44px]" disabled={!dirty} onClick={saveMap}>Save fields</Button>
            </div>
          )}
        </div>
      )}
      {tab === "preview" && (f.preview_available
        ? <PagePreview base={`/project-formats/${f.id}/pages`} label={f.kind === "report" ? "page" : "slide"} wide={f.kind === "ppt"} />
        : <p className="text-sm text-muted text-center py-8">A picture preview needs PDF export, which is not set up on this server yet. Download the file to look at it.</p>)}
      <Button variant="secondary" className="min-h-[44px]" onClick={() => saveFile(`/project-formats/${f.id}/file`).catch(() => push("Could not download the file.", "error"))}><Download size={14} /> Download the format file</Button>
    </div>
  );
}

/** HOD and admin: the official formats students choose from. */
export function ProjectFormats({ role }: { role: "hod" | "admin" }) {
  const { push } = useToast();
  const [data, setData] = useState<{ formats: Format[]; project_types: string[]; pdf: boolean } | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Format | null>(null);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [removing, setRemoving] = useState<Format | null>(null);

  const load = () => {
    setFailed(false);
    api.projectFormats().then(setData).catch(() => setFailed(true));
  };
  const remove = async () => {
    if (!removing) return;
    try {
      await api.deleteProjectFormat(removing.id);
      push("Format deleted");
    } catch (e: any) { push(e?.detail || "Could not delete the format.", "error"); }
    setRemoving(null);
    load();
  };
  useEffect(() => {
    load();
    if (role === "admin") api.adminDepartments().then(setDepartments).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (f: Format) => {
    try {
      await api.editProjectFormat(f.id, { active: !f.active });
      push(f.active ? `"${f.name}" is no longer offered to students.` : `"${f.name}" is offered to students again.`);
      load();
    } catch (e: any) { push(e?.detail || "Could not change that.", "error"); }
  };

  if (failed) return <LoadError message="We couldn't load the project formats." onRetry={load} />;
  if (!data) return <p className="text-sm text-muted p-8 text-center">Loading…</p>;

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-5xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted max-w-xl">Upload the official report and presentation formats once. Students pick one, and their report and slides are written into that exact file.</p>
        <Button className="min-h-[44px]" onClick={() => setAdding(true)}><Plus size={15} /> Upload a format</Button>
      </div>
      {!data.pdf && <div className="p-3 rounded-xl bg-warning/10 text-sm text-ink">PDF export is not set up on this server yet, so formats and finished files can be downloaded as Word and PowerPoint but not previewed as pictures or saved as PDF.</div>}
      <Card className="!p-0 overflow-hidden">
        <div className="px-5 pt-5"><SectionTitle title="Official formats" subtitle="A format that is switched off stays here but is no longer offered." /></div>
        {data.formats.length === 0 ? (
          <EmptyState icon={FileText} title="No format uploaded yet" hint="Upload the college's .docx report format and .pptx presentation format." action={<Button className="min-h-[44px]" onClick={() => setAdding(true)}><Plus size={15} /> Upload the first format</Button>} />
        ) : (
          <ul className="divide-y divide-gray-100">
            {data.formats.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center shrink-0">{f.kind === "report" ? <FileText size={18} className="text-brand" /> : <Presentation size={18} className="text-brand" />}</div>
                <button onClick={() => setOpen(f)} className="flex-1 min-w-[12rem] text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-lg">
                  <div className="text-sm font-medium text-ink break-words">{f.name}</div>
                  <div className="text-xs text-muted">{[f.kind === "report" ? "Report" : "Presentation", f.project_type, f.batch ? `Batch ${f.batch}` : null, f.uploaded].filter(Boolean).join(" · ")}</div>
                </button>
                {!!f.warnings && <Badge tone="warning">{f.warnings} to check</Badge>}
                <Badge tone={f.active ? "success" : "neutral"}>{f.active ? "Offered" : "Switched off"}</Badge>
                <div className="flex gap-1">
                  <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => setOpen(f)}>Open</Button>
                  {f.can_edit && <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => toggle(f)}>{f.active ? "Switch off" : "Switch on"}</Button>}
                  {f.can_edit && <button aria-label={`Delete ${f.name}`} onClick={() => setRemoving(f)} className="w-11 h-11 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center"><Trash2 size={15} /></button>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <CenterModal open={adding} onClose={() => setAdding(false)} title="Upload a format">
        <FormatUpload projectTypes={data.project_types} departments={role === "admin" ? departments : undefined} onDone={(made) => { setAdding(false); load(); setOpen(made); }} />
      </CenterModal>
      <CenterModal open={!!removing} onClose={() => setRemoving(null)} title="Delete this format?" width="max-w-sm">
        <p className="text-sm text-muted mb-5">"{removing?.name}" and its file will be removed. A format that a student's project already uses cannot be deleted; switch it off instead.</p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1 min-h-[44px]" onClick={() => setRemoving(null)}>Cancel</Button>
          <Button variant="danger" className="flex-1 min-h-[44px]" onClick={remove}>Delete</Button>
        </div>
      </CenterModal>
      <CenterModal open={!!open} onClose={() => setOpen(null)} title={open?.name || ""} width="max-w-3xl">
        {open && <FormatDetail id={open.id} onChanged={load} />}
      </CenterModal>
    </div>
  );
}
