"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, CircleDashed, Download, FileText, ImageIcon, Info, Loader2, MessageSquare, Plus, Presentation,
  RefreshCw, Save, Sparkles, Trash2, Upload, UserPlus, X,
} from "lucide-react";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api, saveFile } from "@/lib/api";
import { AREA, AuthImage, Block, Chapter, Draft, DraftView, INPUT, PagePreview, Slide } from "@/components/projects/shared";
import { FormatDetail, FormatUpload } from "@/components/projects/ProjectFormats";

const STEPS = [
  { key: "details", label: "1. Details" }, { key: "format", label: "2. Format" }, { key: "material", label: "3. Material" },
  { key: "sections", label: "4. Sections" }, { key: "write", label: "5. Write & edit" }, { key: "files", label: "6. Files" },
];
const STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = {
  ready: { label: "Enough to write from", tone: "success" }, thin: { label: "Thin: add more if you can", tone: "warning" }, missing: { label: "Nothing to write from", tone: "danger" },
};
const FILES: { key: string; label: string; icon: typeof FileText }[] = [
  { key: "report_docx", label: "Report (.docx)", icon: FileText }, { key: "report_pdf", label: "Report (.pdf)", icon: FileText },
  { key: "ppt_pptx", label: "PPT (.pptx)", icon: Presentation }, { key: "ppt_pdf", label: "PPT (.pdf)", icon: Presentation },
];
const size = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ProjectWorkspace({ id }: { id: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const step = STEPS.some((s) => s.key === params.get("step")) ? (params.get("step") as string) : "details";
  const { push } = useToast();

  const [p, setP] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [start, setStart] = useState<any>(null);
  const [formats, setFormats] = useState<any>(null);
  const [job, setJob] = useState<any>(null);
  const [saving, setSaving] = useState(false);

  // step 1
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState<any>({});
  const [mateQuery, setMateQuery] = useState("");
  const [mates, setMates] = useState<{ name: string; usn: string }[]>([]);
  // step 2
  const [openFormat, setOpenFormat] = useState<number | null>(null);
  const [uploadKind, setUploadKind] = useState<"report" | "ppt" | null>(null);
  // step 3
  const [uploading, setUploading] = useState<string[]>([]);
  // step 4
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // step 5
  const [draft, setDraft] = useState<Draft>({});
  const [dirty, setDirty] = useState(false);
  const [openChapter, setOpenChapter] = useState<number | null>(0);
  const [instruction, setInstruction] = useState<{ target: "chapter" | "slide"; key?: string; index?: number; text: string } | null>(null);
  const [gaps, setGaps] = useState<string[] | null>(null);
  const [writeTab, setWriteTab] = useState<"report" | "slides">("report");
  // step 6
  const [previewing, setPreviewing] = useState<"report" | "slides">("report");
  const [comment, setComment] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const setStep = (k: string) => router.replace(`${pathname}?id=${id}${k === "details" ? "" : `&step=${k}`}`, { scroll: false });

  const adopt = (state: any) => {
    setP(state);
    setTitle(state.title);
    setDetails(state.details || {});
    setAnswers(state.answers || {});
    setDraft(state.content || {});
    setDirty(false);
    if (state.job && (state.job.status === "queued" || state.job.status === "running")) setJob(state.job);
  };
  const load = () => {
    setFailed(false);
    api.project(id).then(adopt).catch(() => setFailed(true));
  };
  useEffect(() => {
    load();
    api.projectStart().then(setStart).catch(() => {});
    api.projectFormats().then(setFormats).catch(() => {});
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  // While a job runs, ask how far it has got every few seconds.
  const polling = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    polling.current = setTimeout(async () => {
      try {
        const next = await api.projectJob(id, job.id);
        setJob(next);
        if (next.status === "done") {
          push(next.kind === "rewrite" ? "Rewritten. Review it, then build the files." : `Version ${next.result?.version} is ready.`);
          load();
          if (next.kind !== "rewrite") setStep("files");
        } else if (next.status === "failed") {
          load();
        }
      } catch {
        setJob({ ...job });               // a dropped request: simply ask again
      }
    }, 2500);
    return () => { if (polling.current) clearTimeout(polling.current); };
  }, [job]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (mateQuery.trim().length < 2) { setMates([]); return; }
    const t = setTimeout(() => api.projectClassmates(mateQuery.trim()).then(setMates).catch(() => setMates([])), 300);
    return () => clearTimeout(t);
  }, [mateQuery]);

  if (failed) return <LoadError message="We couldn't load this project." onRetry={load} />;
  if (!p) return <p className="text-sm text-muted p-8 text-center" role="status">Loading your project…</p>;

  const busy = !!job && (job.status === "queued" || job.status === "running");
  const save = async (payload: Record<string, unknown>, message: string) => {
    setSaving(true);
    try {
      adopt(await api.editProject(id, payload));
      push(message);
    } catch (e: any) { push(e?.detail || "Could not save. Please try again.", "error"); }
    setSaving(false);
  };
  const run = async (payload: Record<string, unknown>) => {
    try {
      if (dirty) adopt(await api.editProject(id, { content: draft }));
      setJob(await api.startProjectJob(id, payload));
      setGaps(null);
      setInstruction(null);
    } catch (e: any) {
      if (e?.status === 422 && e?.data?.chapters) setGaps(e.data.chapters);
      else push(e?.detail || "That could not be started. Please try again.", "error");
    }
  };

  const students: { name: string; usn: string }[] = details.students || [];
  const setDetail = (k: string, v: unknown) => setDetails({ ...details, [k]: v });
  const edit = (next: Draft) => { setDraft(next); setDirty(true); };
  const setChapter = (ci: number, patch: Partial<Chapter>) => edit({ ...draft, chapters: (draft.chapters || []).map((c, i) => (i === ci ? { ...c, ...patch } : c)) });
  const setBlock = (ci: number, bi: number, patch: Partial<Block> | null) => {
    const blocks = [...(draft.chapters?.[ci].blocks || [])];
    if (patch === null) blocks.splice(bi, 1); else blocks[bi] = { ...blocks[bi], ...patch } as Block;
    setChapter(ci, { blocks });
  };
  const setSlide = (si: number, patch: Partial<Slide> | null) => {
    const slides = [...(draft.slides || [])];
    if (patch === null) slides.splice(si, 1); else slides[si] = { ...slides[si], ...patch };
    edit({ ...draft, slides });
  };
  const moveSlide = (si: number, by: number) => {
    const slides = [...(draft.slides || [])];
    const to = si + by;
    if (to < 0 || to >= slides.length) return;
    [slides[si], slides[to]] = [slides[to], slides[si]];
    edit({ ...draft, slides });
  };
  const imagePath = (imageId: number) => `/student/projects/${id}/images/${imageId}`;
  const reportFormats = (formats?.formats || []).filter((f: any) => f.kind === "report");
  const pptFormats = (formats?.formats || []).filter((f: any) => f.kind === "ppt");
  const latest = p.versions[0];
  const written = (draft.chapters || []).some((c) => c.blocks?.length);
  const hasFormat = !!(p.report_format_id || p.ppt_format_id);

  const uploadFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      setUploading((u) => [...u, file.name]);
      try {
        const r = await api.addProjectMaterial(id, file);
        push(`${file.name}: ${[r.characters ? `${r.characters.toLocaleString()} characters read` : null, r.pictures ? `${r.pictures} picture${r.pictures === 1 ? "" : "s"}` : null, r.tables ? `${r.tables} table${r.tables === 1 ? "" : "s"}` : null].filter(Boolean).join(", ") || "added"}`);
      } catch (e: any) {
        push(`${file.name}: ${e?.detail || "could not be added"}`, "error");
      }
      setUploading((u) => u.filter((n) => n !== file.name));
    }
    load();
  };

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={() => router.push(pathname)} className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-brand hover:underline"><ArrowLeft size={15} /> All projects</button>
        <h2 className="text-base font-semibold text-ink flex-1 min-w-[12rem] break-words">{p.title}</h2>
      </div>

      <div role="tablist" aria-label="Steps" className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
        {STEPS.map((s) => (
          <button key={s.key} role="tab" aria-selected={step === s.key} onClick={() => setStep(s.key)} className={`px-3 min-h-[40px] rounded-lg text-xs font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${step === s.key ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{s.label}</button>
        ))}
      </div>

      {busy && (
        <div role="status" className="rounded-2xl border border-brand/20 bg-brand-light p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-ink"><Loader2 size={16} className="animate-spin text-brand" /> {job.step || "Working…"}</div>
          <div className="h-2 rounded-full bg-white mt-3 overflow-hidden" aria-hidden><div className="h-full bg-brand transition-all duration-700" style={{ width: `${Math.max(4, job.percent || 0)}%` }} /></div>
          <p className="text-xs text-muted mt-2">This runs on the server. You can leave this page and come back; nothing is lost.</p>
        </div>
      )}
      {job?.status === "failed" && (
        <div role="alert" className="flex items-start gap-3 p-4 rounded-2xl bg-danger/10">
          <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
          <p className="text-sm text-ink flex-1">{job.error}</p>
          <button aria-label="Dismiss" onClick={() => setJob(null)} className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/50"><X size={15} /></button>
        </div>
      )}

      {/* ---------------- 1. details ---------------- */}
      {step === "details" && (
        <Card>
          <SectionTitle title="Project details" subtitle="These fill the cover page, certificate, declaration and the title slide. Names are taken from the college records where possible." />
          <div className="grid md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label htmlFor="pd-title" className="text-xs font-medium text-muted mb-1 block">Project title</label>
              <input id="pd-title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
            </div>
            <div>
              <label htmlFor="pd-type" className="text-xs font-medium text-muted mb-1 block">Project type</label>
              <select id="pd-type" value={details.project_type || ""} onChange={(e) => setDetail("project_type", e.target.value)} className={INPUT}>
                <option value="">Choose…</option>
                {(start?.project_types || []).map((t: string) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="pd-year" className="text-xs font-medium text-muted mb-1 block">Academic year</label>
              <input id="pd-year" value={details.academic_year || ""} onChange={(e) => setDetail("academic_year", e.target.value)} placeholder={start?.academic_year || "2025-2026"} className={INPUT} />
            </div>
            <div>
              <label htmlFor="pd-domain" className="text-xs font-medium text-muted mb-1 block">Domain</label>
              <input id="pd-domain" value={details.domain || ""} onChange={(e) => setDetail("domain", e.target.value)} placeholder="e.g. Machine learning, IoT, Web application" className={INPUT} />
            </div>
            <div>
              <label htmlFor="pd-stack" className="text-xs font-medium text-muted mb-1 block">Technology used</label>
              <input id="pd-stack" value={details.tech_stack || ""} onChange={(e) => setDetail("tech_stack", e.target.value)} placeholder="e.g. Python, Flask, MySQL" className={INPUT} />
            </div>

            <fieldset className="md:col-span-2">
              <legend className="text-xs font-medium text-muted mb-1">Team members</legend>
              <ul className="space-y-2">
                {students.map((s, i) => (
                  <li key={i} className="grid grid-cols-[1fr_9rem_auto] gap-2">
                    <input aria-label={`Name of member ${i + 1}`} value={s.name} onChange={(e) => setDetail("students", students.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={INPUT} />
                    <input aria-label={`USN of member ${i + 1}`} value={s.usn} onChange={(e) => setDetail("students", students.map((x, j) => (j === i ? { ...x, usn: e.target.value.toUpperCase() } : x)))} className={INPUT} />
                    <button aria-label={`Remove ${s.name || "member"}`} disabled={students.length <= 1} onClick={() => setDetail("students", students.filter((_, j) => j !== i))} className="w-11 h-11 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center disabled:opacity-30"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
              {students.length < 8 && (
                <div className="mt-2 relative max-w-md">
                  <label htmlFor="pd-mate" className="sr-only">Add a teammate by name or USN</label>
                  <UserPlus size={15} className="absolute left-3.5 top-[14px] text-muted" />
                  <input id="pd-mate" value={mateQuery} onChange={(e) => setMateQuery(e.target.value)} placeholder="Add a teammate: type a name or USN" className={`${INPUT} pl-10`} />
                  {mateQuery.trim().length >= 2 && (
                    <ul className="mt-1 rounded-xl border border-gray-100 bg-white shadow-card overflow-hidden">
                      {mates.filter((m) => !students.some((s) => s.usn === m.usn)).map((m) => (
                        <li key={m.usn}><button onClick={() => { setDetail("students", [...students, m]); setMateQuery(""); }} className="w-full text-left px-3.5 min-h-[44px] text-sm text-ink hover:bg-gray-50">{m.name} <span className="text-muted">· {m.usn}</span></button></li>
                      ))}
                      <li><button onClick={() => { setDetail("students", [...students, { name: mateQuery.trim(), usn: "" }]); setMateQuery(""); }} className="w-full text-left px-3.5 min-h-[44px] text-sm text-brand hover:bg-gray-50">Add "{mateQuery.trim()}" and type the USN myself</button></li>
                    </ul>
                  )}
                </div>
              )}
            </fieldset>

            <div>
              <label htmlFor="pd-guide" className="text-xs font-medium text-muted mb-1 block">Guide</label>
              <input id="pd-guide" list="pd-guides" value={details.guide_name || ""} onChange={(e) => { const g = (start?.guides || []).find((x: any) => x.name === e.target.value); setDetails({ ...details, guide_name: e.target.value, ...(g?.designation ? { guide_designation: g.designation } : {}) }); }} placeholder="Choose or type the name" className={INPUT} />
              <datalist id="pd-guides">{(start?.guides || []).map((g: any) => <option key={g.id} value={g.name} />)}</datalist>
            </div>
            <div>
              <label htmlFor="pd-guide-d" className="text-xs font-medium text-muted mb-1 block">Guide's designation</label>
              <input id="pd-guide-d" value={details.guide_designation || ""} onChange={(e) => setDetail("guide_designation", e.target.value)} placeholder="e.g. Assistant Professor" className={INPUT} />
            </div>
            {([["hod_name", "Head of the department", start?.hod_name], ["principal_name", "Principal", ""], ["department", "Department", start?.department], ["college", "College", start?.college]] as const).map(([key, label, hint]) => (
              <div key={key}>
                <label htmlFor={`pd-${key}`} className="text-xs font-medium text-muted mb-1 block">{label}</label>
                <div className="flex gap-2">
                  <input id={`pd-${key}`} value={details[key] || ""} onChange={(e) => setDetail(key, e.target.value)} className={INPUT} />
                  {hint && !details[key] && <Button variant="secondary" size="sm" className="min-h-[44px] shrink-0" onClick={() => setDetail(key, hint)}>Use record</Button>}
                </div>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 mt-5">
            <Button className="min-h-[44px]" disabled={saving} onClick={() => save({ title, details }, "Details saved")}><Save size={15} /> Save details</Button>
            <Button variant="secondary" className="min-h-[44px]" onClick={() => setStep("format")}>Next: choose the format</Button>
            <Button variant="danger" className="min-h-[44px] ml-auto" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete project</Button>
          </div>
        </Card>
      )}

      {/* ---------------- 2. format ---------------- */}
      {step === "format" && (
        <div className="grid lg:grid-cols-2 gap-5">
          {([["report", "Report format", reportFormats, p.report_format_id, "report_format_id"], ["ppt", "Presentation format", pptFormats, p.ppt_format_id, "ppt_format_id"]] as const).map(([kind, heading, list, chosen, field]) => (
            <Card key={kind}>
              <SectionTitle title={heading} subtitle={kind === "report" ? "Your report is written into this exact Word file." : "Your slides are made from this exact PowerPoint file."} />
              {!formats ? <p className="text-sm text-muted">Loading…</p> : list.length === 0 ? (
                <EmptyState compact icon={kind === "report" ? FileText : Presentation} title="No official format yet" hint="Your department has not uploaded one. If your guide gave you a format file, upload it below." />
              ) : (
                <ul className="space-y-2" role="radiogroup" aria-label={heading}>
                  {list.map((f: any) => (
                    <li key={f.id} className={`flex items-center gap-2 rounded-xl border-2 p-2 ${chosen === f.id ? "border-brand bg-brand-light" : "border-gray-100"}`}>
                      <button role="radio" aria-checked={chosen === f.id} onClick={() => save({ [field]: f.id }, `${heading} chosen`)} className="flex-1 min-w-0 text-left px-2 min-h-[44px] outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-lg">
                        <span className="block text-sm font-medium text-ink break-words">{f.name}</span>
                        <span className="block text-xs text-muted">{[f.scope === "official" ? "Official" : "Uploaded by you", f.project_type, f.batch ? `Batch ${f.batch}` : null].filter(Boolean).join(" · ")}</span>
                      </button>
                      {chosen === f.id && <CheckCircle2 size={18} className="text-brand shrink-0" />}
                      <Button variant="ghost" size="sm" className="min-h-[44px] shrink-0" onClick={() => setOpenFormat(f.id)}>Look</Button>
                    </li>
                  ))}
                </ul>
              )}
              <Button variant="secondary" className="min-h-[44px] mt-3" onClick={() => setUploadKind(kind)}><Upload size={14} /> Upload a different format</Button>
            </Card>
          ))}
          <div className="lg:col-span-2"><Button className="min-h-[44px]" onClick={() => setStep("material")}>Next: add your material</Button></div>
        </div>
      )}

      {/* ---------------- 3. material ---------------- */}
      {step === "material" && (
        <div className="space-y-5">
          <Card>
            <SectionTitle title="Your material" subtitle="Everything the report says comes from here and from your answers in the next step. Nothing is added from outside." />
            <input id="mat-files" type="file" multiple className="sr-only" accept=".pdf,.docx,.pptx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.csv,.xlsx,.zip,.py,.js,.ts,.tsx,.jsx,.java,.c,.cpp,.h,.cs,.go,.php,.html,.css,.sql,.ipynb,.json,.kt,.dart,.rb,.rs,.ino" onChange={(e) => { uploadFiles(e.target.files); e.target.value = ""; }} />
            <label htmlFor="mat-files" className="flex flex-col items-center justify-center gap-2 min-h-[120px] rounded-2xl border-2 border-dashed border-gray-200 hover:border-brand/50 hover:bg-brand-50 cursor-pointer text-center p-4 transition-colors">
              <Upload size={24} className="text-brand" />
              <span className="text-sm font-medium text-ink">Choose files</span>
              <span className="text-xs text-muted max-w-md">Synopsis, abstract, notes, earlier drafts (PDF, Word, PowerPoint, text), screenshots and diagrams, results as CSV or Excel, code files or a .zip of the code. Up to 20 MB each.</span>
            </label>
            {uploading.length > 0 && <p className="text-sm text-muted mt-3" role="status"><Loader2 size={14} className="inline animate-spin mr-1" /> Reading {uploading.join(", ")}…</p>}
            {p.materials.length === 0 ? <p className="text-sm text-muted mt-4">No files yet. You can also skip files and type everything in the next step.</p> : (
              <ul className="divide-y divide-gray-100 mt-4">
                {p.materials.map((m: any) => (
                  <li key={m.id} className="flex items-center gap-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink break-all">{m.filename}</div>
                      <div className="text-xs text-muted">{[size(m.size), m.characters ? `${m.characters.toLocaleString()} characters read` : null, m.tables ? `${m.tables} table${m.tables === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")}</div>
                      {m.note && <div className="text-xs text-[#9c6b12] mt-0.5">{m.note}</div>}
                    </div>
                    <button aria-label={`Remove ${m.filename}`} onClick={async () => { try { await api.removeProjectMaterial(id, m.id); push("Removed"); load(); } catch { push("Could not remove it.", "error"); } }} className="w-11 h-11 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center shrink-0"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <SectionTitle title="Pictures" subtitle="Screenshots and diagrams found in your files. Give each a caption: it becomes the figure caption in the report." />
            {p.images.length === 0 ? <EmptyState compact icon={ImageIcon} title="No pictures yet" hint="Upload screenshots or diagrams above, or a document that contains them." /> : (
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {p.images.map((im: any) => (
                  <li key={im.id} className="rounded-xl border border-gray-100 p-2.5">
                    <AuthImage path={imagePath(im.id)} alt={im.caption || im.name} className="w-full h-36 object-contain rounded-lg bg-gray-50" />
                    {im.source === "generated" && <Badge tone="info" className="mt-2">Drawn from your module list</Badge>}
                    <input aria-label={`Caption for ${im.name}`} defaultValue={im.caption || ""} placeholder="Caption, e.g. Login page" onBlur={async (e) => { if (e.target.value !== (im.caption || "")) { await api.editProjectImage(id, im.id, e.target.value).catch(() => {}); load(); } }} className={`${INPUT} mt-2`} />
                    <button onClick={async () => { try { await api.deleteProjectImage(id, im.id); push("Picture removed"); load(); } catch { push("Could not remove it.", "error"); } }} className="mt-1 inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-danger hover:underline"><Trash2 size={13} /> Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Button className="min-h-[44px]" onClick={() => setStep("sections")}>Next: check each section</Button>
        </div>
      )}

      {/* ---------------- 4. sections ---------------- */}
      {step === "sections" && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-brand-light">
            <Info size={18} className="text-brand shrink-0 mt-0.5" />
            <p className="text-sm text-ink">For each chapter this shows whether your files give enough to write from. Where they don't, answer the questions in your own words. A chapter with nothing behind it is left out rather than made up.</p>
          </div>
          {p.readiness.map((c: any) => (
            <Card key={c.key}>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <h3 className="text-base font-semibold text-ink">{c.title}</h3>
                <Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>
              </div>
              {c.material_found && <p className="text-xs text-muted mb-3">Related text was found in your files.</p>}
              <div className="space-y-3">
                {c.questions.map((q: any) => (
                  <div key={q.id}>
                    <label htmlFor={`q-${q.id}`} className="text-sm font-medium text-ink block">{q.label}{q.required && c.status !== "ready" && !q.answered ? <span className="text-danger"> · needed</span> : null}</label>
                    <p className="text-xs text-muted mb-1">{q.hint}</p>
                    <textarea id={`q-${q.id}`} rows={3} value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} className={AREA} />
                  </div>
                ))}
              </div>
            </Card>
          ))}
          <Card>
            {p.global_questions.map((q: any) => (
              <div key={q.id}>
                <label htmlFor={`q-${q.id}`} className="text-base font-semibold text-ink block">{q.label}</label>
                <p className="text-xs text-muted mb-1">{q.hint} References are never written for you.</p>
                <textarea id={`q-${q.id}`} rows={5} value={answers[q.id] || ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} className={AREA} />
              </div>
            ))}
            <label className="flex items-start gap-3 min-h-[44px] text-sm text-ink cursor-pointer mt-3">
              <input type="checkbox" checked={details.make_diagram !== false} onChange={(e) => setDetail("make_diagram", e.target.checked)} className="w-5 h-5 mt-0.5 accent-[#5B3FD9]" />
              <span>Draw a simple block diagram from my module list<span className="block text-xs text-muted">It shows only the module names you typed, in order, and is labelled as drawn from your list.</span></span>
            </label>
          </Card>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-[44px]" disabled={saving} onClick={() => save({ answers, details: { make_diagram: details.make_diagram !== false } }, "Answers saved")}><Save size={15} /> Save answers</Button>
            <Button variant="secondary" className="min-h-[44px]" onClick={() => setStep("write")}>Next: write</Button>
          </div>
        </div>
      )}

      {/* ---------------- 5. write & edit ---------------- */}
      {step === "write" && (
        <div className="space-y-4">
          <Card>
            <SectionTitle title={written ? "Your draft" : "Write the report and slides"} subtitle={written ? "Edit anything. Then build the files to get a new version." : "Each chapter is written from your material and answers, then the slides are made from the report."} />
            {!hasFormat && <p className="text-sm text-danger mb-3">Choose a format in step 2 first.</p>}
            {!p.environment.writing_model && <p className="text-sm text-danger mb-3">The writing model is not set up on this server.</p>}
            <div className="flex flex-wrap gap-2">
              <Button className="min-h-[44px]" disabled={busy || !hasFormat || !p.environment.writing_model} onClick={() => run({ kind: "generate" })}><Sparkles size={15} /> {written ? "Write everything again" : "Write it"}</Button>
              {written && <Button variant="secondary" className="min-h-[44px]" disabled={busy || !dirty || saving} onClick={() => save({ content: draft }, "Draft saved")}><Save size={15} /> Save my edits</Button>}
              {written && <Button variant="secondary" className="min-h-[44px]" disabled={busy || !hasFormat} onClick={() => run({ kind: "build" })}><RefreshCw size={15} /> Build the files</Button>}
            </div>
            {written && <p className="text-xs text-muted mt-3 flex items-start gap-1.5"><Info size={13} className="shrink-0 mt-0.5" /> This draft was written from your own material. Read all of it before you submit: you are responsible for what it says.</p>}
          </Card>

          {(draft.warnings || []).length > 0 && (
            <Card>
              <SectionTitle title={`${draft.warnings!.length} sentence${draft.warnings!.length === 1 ? " was" : "s were"} left out`} subtitle="They stated a figure or a citation that is not in your material. If one is true, add the figure to your answers and write the chapter again." />
              <ul className="text-xs text-muted space-y-1.5 max-h-48 overflow-y-auto">{draft.warnings!.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Card>
          )}

          {written && (
            <>
              <div role="tablist" aria-label="Draft" className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
                {([["report", `Report (${(draft.chapters || []).filter((c) => c.blocks?.length).length} chapters)`], ["slides", `Slides (${(draft.slides || []).length})`]] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={writeTab === k} onClick={() => setWriteTab(k)} className={`px-3 min-h-[40px] rounded-lg text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${writeTab === k ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{label}</button>
                ))}
              </div>

              {writeTab === "report" && (
                <div className="space-y-3">
                  <Card>
                    <label htmlFor="ed-abstract" className="text-base font-semibold text-ink block mb-1">Abstract</label>
                    <textarea id="ed-abstract" rows={5} value={(draft.abstract || []).join("\n\n")} onChange={(e) => edit({ ...draft, abstract: e.target.value.split(/\n\s*\n/).filter((x) => x.trim()) })} className={AREA} />
                  </Card>
                  {(draft.chapters || []).map((c, ci) => (
                    <Card key={c.key + ci} className="!p-0 overflow-hidden">
                      <button aria-expanded={openChapter === ci} onClick={() => setOpenChapter(openChapter === ci ? null : ci)} className="w-full flex items-center gap-3 px-5 min-h-[56px] text-left outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                        {c.blocks?.length ? <CheckCircle2 size={17} className="text-success shrink-0" /> : <CircleDashed size={17} className="text-muted shrink-0" />}
                        <span className="flex-1 text-sm font-semibold text-ink">{c.blocks?.length ? `Chapter ${(draft.chapters || []).slice(0, ci + 1).filter((x) => x.blocks?.length).length}: ` : ""}{c.title}</span>
                        {!c.blocks?.length && <Badge tone="danger">Not written</Badge>}
                      </button>
                      {openChapter === ci && (
                        <div className="px-5 pb-5 space-y-3 border-t border-gray-100 pt-4">
                          {(c.missing || []).length > 0 && (
                            <div className="p-3 rounded-xl bg-warning/10 text-sm text-ink">
                              <div className="font-semibold mb-1">{c.blocks?.length ? "This chapter would be stronger with:" : "Not written, because there was nothing to write it from. It needs:"}</div>
                              <ul className="list-disc pl-5 space-y-0.5">{c.missing!.map((m, i) => <li key={i}>{m}</li>)}</ul>
                              <button onClick={() => setStep("sections")} className="text-brand font-semibold hover:underline mt-1.5 min-h-[36px]">Answer in step 4</button>
                            </div>
                          )}
                          {(c.blocks || []).map((b, bi) => (
                            <div key={bi} className="flex gap-2 items-start">
                              <div className="flex-1 min-w-0">
                                {b.type === "heading" && <input aria-label="Section heading" value={b.text} onChange={(e) => setBlock(ci, bi, { text: e.target.value })} className={`${INPUT} font-semibold`} />}
                                {b.type === "para" && <textarea aria-label="Paragraph" rows={Math.min(10, Math.max(3, Math.ceil(b.text.length / 110)))} value={b.text} onChange={(e) => setBlock(ci, bi, { text: e.target.value })} className={AREA} />}
                                {b.type === "bullets" && <textarea aria-label="List, one item per line" rows={Math.max(2, b.items.length)} value={b.items.join("\n")} onChange={(e) => setBlock(ci, bi, { items: e.target.value.split("\n") })} className={AREA} />}
                                {b.type === "figure" && (
                                  <div className="flex gap-3 items-center rounded-xl border border-gray-100 p-2">
                                    <AuthImage path={imagePath(b.image_id)} alt={b.caption} className="w-24 h-16 object-contain rounded bg-gray-50 shrink-0" />
                                    <input aria-label="Figure caption" value={b.caption} onChange={(e) => setBlock(ci, bi, { caption: e.target.value })} className={INPUT} />
                                  </div>
                                )}
                                {b.type === "table" && (
                                  <div className="rounded-xl border border-gray-100 p-2">
                                    <input aria-label="Table caption" value={b.caption} onChange={(e) => setBlock(ci, bi, { caption: e.target.value })} className={INPUT} />
                                    <p className="text-xs text-muted mt-1">{b.rows.length} rows × {b.rows[0]?.length || 0} columns, copied from your file: {b.rows[0]?.join(" | ")}</p>
                                  </div>
                                )}
                              </div>
                              <button aria-label={`Remove this ${b.type === "para" ? "paragraph" : b.type}`} onClick={() => setBlock(ci, bi, null)} className="w-11 h-11 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center shrink-0"><Trash2 size={15} /></button>
                            </div>
                          ))}
                          <div className="flex flex-wrap gap-2 pt-1">
                            <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => setChapter(ci, { blocks: [...(c.blocks || []), { type: "heading", level: 2, text: "New section" }] })}><Plus size={14} /> Heading</Button>
                            <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => setChapter(ci, { blocks: [...(c.blocks || []), { type: "para", text: "" }] })}><Plus size={14} /> Paragraph</Button>
                            {p.images.filter((im: any) => !(draft.chapters || []).some((x) => x.blocks?.some((b) => b.type === "figure" && b.image_id === im.id))).length > 0 && (
                              <select aria-label="Add a picture to this chapter" value="" onChange={(e) => { const im = p.images.find((x: any) => String(x.id) === e.target.value); if (im) setChapter(ci, { blocks: [...(c.blocks || []), { type: "figure", image_id: im.id, caption: im.caption || "" }] }); }} className="border border-gray-200 bg-white rounded-xl px-3 min-h-[44px] text-xs font-semibold text-brand">
                                <option value="">+ Picture…</option>
                                {p.images.filter((im: any) => !(draft.chapters || []).some((x) => x.blocks?.some((b) => b.type === "figure" && b.image_id === im.id))).map((im: any) => <option key={im.id} value={im.id}>{im.caption || im.name}</option>)}
                              </select>
                            )}
                            <Button size="sm" className="min-h-[44px] ml-auto" disabled={busy} onClick={() => setInstruction({ target: "chapter", key: c.key, text: "" })}><Sparkles size={14} /> {c.blocks?.length ? "Rewrite this chapter" : "Write this chapter"}</Button>
                          </div>
                        </div>
                      )}
                    </Card>
                  ))}
                  <Card>
                    <label htmlFor="ed-refs" className="text-base font-semibold text-ink block">References</label>
                    <p className="text-xs text-muted mb-1">One per line. Only the ones you list appear; they are numbered for you.</p>
                    <textarea id="ed-refs" rows={Math.max(3, (draft.references || []).length + 1)} value={(draft.references || []).join("\n")} onChange={(e) => edit({ ...draft, references: e.target.value.split("\n") })} className={AREA} />
                  </Card>
                </div>
              )}

              {writeTab === "slides" && (
                <div className="space-y-3">
                  <p className="text-sm text-muted">The title slide and the closing slide come from the format. A slide with too much text continues on a second slide; the font is never made smaller.</p>
                  {(draft.slides || []).map((s, si) => (
                    <Card key={si}>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-xs font-semibold text-muted">Slide {si + 2}</span>
                        <div className="ml-auto flex">
                          <button aria-label="Move slide up" disabled={si === 0} onClick={() => moveSlide(si, -1)} className="w-11 h-11 rounded-xl text-muted hover:bg-gray-50 flex items-center justify-center disabled:opacity-30"><ArrowUp size={15} /></button>
                          <button aria-label="Move slide down" disabled={si === (draft.slides || []).length - 1} onClick={() => moveSlide(si, 1)} className="w-11 h-11 rounded-xl text-muted hover:bg-gray-50 flex items-center justify-center disabled:opacity-30"><ArrowDown size={15} /></button>
                          <button aria-label={`Delete slide ${s.title}`} onClick={() => setSlide(si, null)} className="w-11 h-11 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center"><Trash2 size={15} /></button>
                        </div>
                      </div>
                      <input aria-label="Slide title" value={s.title} onChange={(e) => setSlide(si, { title: e.target.value })} className={`${INPUT} font-semibold`} />
                      <label className="text-xs text-muted block mt-2 mb-1" htmlFor={`sl-b-${si}`}>Points, one per line</label>
                      <textarea id={`sl-b-${si}`} rows={Math.max(3, s.bullets.length)} value={s.bullets.join("\n")} onChange={(e) => setSlide(si, { bullets: e.target.value.split("\n") })} className={AREA} />
                      <label className="text-xs text-muted block mt-2 mb-1" htmlFor={`sl-n-${si}`}>Speaker notes</label>
                      <textarea id={`sl-n-${si}`} rows={2} value={s.notes || ""} onChange={(e) => setSlide(si, { notes: e.target.value })} className={AREA} />
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {s.image_id != null && <AuthImage path={imagePath(s.image_id)} alt="Picture on this slide" className="w-20 h-14 object-contain rounded bg-gray-50" />}
                        <select aria-label="Picture on this slide" value={s.image_id ?? ""} onChange={(e) => setSlide(si, { image_id: e.target.value ? Number(e.target.value) : undefined })} className="border border-gray-200 bg-white rounded-xl px-3 min-h-[44px] text-xs text-ink">
                          <option value="">No picture</option>
                          {p.images.map((im: any) => <option key={im.id} value={im.id}>{im.caption || im.name}</option>)}
                        </select>
                        <Button size="sm" variant="secondary" className="min-h-[44px] ml-auto" disabled={busy} onClick={() => setInstruction({ target: "slide", index: si, text: "" })}><Sparkles size={14} /> Rewrite this slide</Button>
                      </div>
                    </Card>
                  ))}
                  <Button variant="secondary" className="min-h-[44px]" onClick={() => edit({ ...draft, slides: [...(draft.slides || []), { title: "New slide", bullets: [""], notes: "" }] })}><Plus size={14} /> Add a slide</Button>
                </div>
              )}
              {dirty && <div className="sticky bottom-[68px] lg:bottom-4 flex justify-end"><Button className="min-h-[44px] shadow-cardHover" disabled={busy || saving} onClick={() => save({ content: draft }, "Draft saved")}><Save size={15} /> Save my edits</Button></div>}
            </>
          )}
        </div>
      )}

      {/* ---------------- 6. files ---------------- */}
      {step === "files" && (
        <div className="space-y-5">
          {!latest ? (
            <Card><EmptyState icon={FileText} title="No files built yet" hint="Write the draft in step 5. The files are built straight after." action={<Button className="min-h-[44px]" onClick={() => setStep("write")}>Go to step 5</Button>} /></Card>
          ) : (
            <>
              <Card>
                <SectionTitle title={`Version ${latest.number}`} subtitle={`Built ${latest.created}. Every version is kept below.`} />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  {FILES.map((f) => {
                    const there = latest.files.includes(f.key);
                    return (
                      <Button key={f.key} variant={there ? "primary" : "secondary"} className="min-h-[52px] w-full" disabled={!there} onClick={() => saveFile(`/student/projects/${id}/versions/${latest.number}/${f.key}`).then((n) => push(`${n} downloaded`)).catch((e) => push(e?.detail || "Could not download.", "error"))}>
                        <Download size={15} /> {f.label}
                      </Button>
                    );
                  })}
                </div>
                {!p.environment.pdf.available && <p className="text-sm text-muted mt-3">The PDF buttons are off because PDF export is not set up on this server yet. The Word and PowerPoint files are complete.</p>}
                <ul className="mt-4 text-sm text-ink space-y-1.5">
                  {latest.report.report && <li>Report: {latest.report.report.pages ? `${latest.report.report.pages} pages, ` : ""}{latest.report.report.figures} figure{latest.report.report.figures === 1 ? "" : "s"}, {latest.report.report.tables} table{latest.report.report.tables === 1 ? "" : "s"}.</li>}
                  {latest.report.slides && <li>Slides: {latest.report.slides.count}{latest.report.slides.continued ? `, of which ${latest.report.slides.continued} continue a slide that had too much text` : ""}.</li>}
                  {[...(latest.report.report?.unfilled || []), ...(latest.report.slides?.unfilled || [])].filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).map((u: string) => <li key={u} className="text-danger">Not filled in, because it is missing from your details: {u}. <button onClick={() => setStep("details")} className="underline font-semibold">Add it in step 1</button></li>)}
                  {(latest.report.report?.leftover_wording || []).map((w: string) => <li key={w} className="text-danger">The format's own wording is still in the file: "{w}".</li>)}
                  {(latest.report.slides?.too_much_text_on || []).map((w: string) => <li key={w} className="text-danger">Too much text to fit on: {w}. Shorten it in step 5.</li>)}
                  {(latest.report.slides?.text_reduced_on || []).length > 0 && <li className="text-muted">The text on the title slide was reduced slightly so that all names fit.</li>}
                  {(latest.report.notes || []).map((n: string) => <li key={n} className="text-muted">{n}</li>)}
                </ul>
              </Card>

              <Card>
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <h3 className="text-lg font-semibold text-ink">Preview</h3>
                  <div role="tablist" aria-label="Preview" className="flex gap-1 bg-gray-100 rounded-xl p-1">
                    {(["report", "slides"] as const).map((k) => <button key={k} role="tab" aria-selected={previewing === k} onClick={() => setPreviewing(k)} className={`px-3 min-h-[40px] rounded-lg text-xs font-semibold ${previewing === k ? "bg-brand text-white" : "text-muted"}`}>{k === "report" ? "Report" : "Slides"}</button>)}
                  </div>
                </div>
                {latest.files.includes(previewing === "report" ? "report_pdf" : "ppt_pdf")
                  ? <PagePreview base={`/student/projects/${id}/versions/${latest.number}/pages/${previewing}`} label={previewing === "report" ? "page" : "slide"} wide={previewing === "slides"} />
                  : <><p className="text-sm text-muted mb-3">This shows the content only. The exact pages, with the format's cover, headers and page numbers, are in the downloaded file.</p><DraftView draft={p.content} imagePath={imagePath} only={previewing} /></>}
              </Card>

              <Card>
                <SectionTitle title="All versions" />
                <ul className="divide-y divide-gray-100">
                  {p.versions.map((v: any) => (
                    <li key={v.number} className="flex items-center gap-2 py-2 flex-wrap">
                      <div className="flex-1 min-w-[9rem]"><div className="text-sm font-medium text-ink">Version {v.number}</div><div className="text-xs text-muted">{v.created}</div></div>
                      {FILES.filter((f) => v.files.includes(f.key)).map((f) => (
                        <button key={f.key} onClick={() => saveFile(`/student/projects/${id}/versions/${v.number}/${f.key}`).catch(() => push("Could not download.", "error"))} className="px-2.5 min-h-[40px] rounded-lg text-xs font-semibold text-brand hover:bg-brand-light">{f.label.replace("Report ", "").replace("PPT ", "")}</button>
                      ))}
                      {v.number !== latest.number && <Button size="sm" variant="ghost" className="min-h-[44px]" disabled={busy} onClick={async () => { try { adopt(await api.restoreProjectVersion(id, v.number)); push(`The draft is back to version ${v.number}. Build the files to make it the newest.`); setStep("write"); } catch (e: any) { push(e?.detail || "Could not restore.", "error"); } }}>Use this draft</Button>}
                    </li>
                  ))}
                </ul>
              </Card>
            </>
          )}

          <Card>
            <SectionTitle title="Guide review" subtitle="Share the draft and its files with your guide. They can read, download and comment; they cannot change anything." />
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Share with" value={p.shared_with?.id || ""} onChange={async (e) => { try { adopt(await api.shareProject(id, e.target.value ? Number(e.target.value) : null)); push(e.target.value ? "Shared with your guide. They have been notified." : "No longer shared."); } catch (err: any) { push(err?.detail || "Could not change sharing.", "error"); } }} className="border border-gray-200 bg-white rounded-xl px-3 min-h-[44px] text-sm text-ink">
                <option value="">Not shared</option>
                {(start?.guides || []).map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              {p.shared_with && <Badge tone="success">Shared with {p.shared_with.name}</Badge>}
            </div>
            {p.comments.length > 0 && (
              <ul className="mt-4 space-y-2">
                {p.comments.map((c: any) => (
                  <li key={c.id} className={`rounded-xl border border-gray-100 p-3 ${c.resolved ? "opacity-60" : ""}`}>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted"><MessageSquare size={13} /> {c.author} · {c.role === "teacher" ? "Guide" : "You"} · {c.section} · {c.when}{c.resolved && <Badge tone="success">Done</Badge>}</div>
                    <p className="text-sm text-ink mt-1 whitespace-pre-wrap break-words">{c.body}</p>
                    {c.role === "teacher" && <button onClick={async () => { await api.resolveProjectComment(id, c.id).catch(() => {}); load(); }} className="text-xs font-semibold text-brand hover:underline min-h-[36px]">{c.resolved ? "Mark as not done" : "Mark as done"}</button>}
                  </li>
                ))}
              </ul>
            )}
            {p.shared_with && (
              <div className="mt-3 flex gap-2">
                <label htmlFor="gr-reply" className="sr-only">Reply to your guide</label>
                <input id="gr-reply" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Reply to your guide" className={INPUT} />
                <Button className="min-h-[44px] shrink-0" disabled={comment.trim().length < 2} onClick={async () => { try { await api.commentOnProject(id, "general", comment); setComment(""); load(); } catch (e: any) { push(e?.detail || "Could not send.", "error"); } }}>Send</Button>
              </div>
            )}
          </Card>
        </div>
      )}

      <CenterModal open={openFormat !== null} onClose={() => setOpenFormat(null)} title="Format" width="max-w-3xl">
        {openFormat !== null && <FormatDetail id={openFormat} />}
      </CenterModal>
      <CenterModal open={uploadKind !== null} onClose={() => setUploadKind(null)} title={uploadKind === "ppt" ? "Upload your presentation format" : "Upload your report format"}>
        {uploadKind && <FormatUpload kind={uploadKind} projectTypes={formats?.project_types || []} onDone={async (made) => { setUploadKind(null); setFormats(await api.projectFormats().catch(() => formats)); await save({ [uploadKind === "report" ? "report_format_id" : "ppt_format_id"]: made.id }, "Format uploaded and chosen"); setOpenFormat(made.id); }} />}
      </CenterModal>
      <CenterModal open={!!instruction} onClose={() => setInstruction(null)} title={instruction?.target === "slide" ? "Rewrite this slide" : "Rewrite this chapter"}>
        {instruction && (
          <div className="space-y-3">
            <label htmlFor="rw-text" className="text-sm text-ink block">Anything in particular? <span className="text-muted">(optional)</span></label>
            <textarea id="rw-text" autoFocus rows={3} maxLength={500} value={instruction.text} onChange={(e) => setInstruction({ ...instruction, text: e.target.value })} placeholder='e.g. "make it shorter", "say more about the database design"' className={AREA} />
            <p className="text-xs text-muted">It is rewritten from your material only. Your unsaved edits elsewhere are saved first.</p>
            <Button className="w-full min-h-[44px]" onClick={() => run({ kind: "rewrite", target: instruction.target, key: instruction.key, index: instruction.index, instruction: instruction.text })}><Sparkles size={15} /> Rewrite</Button>
          </div>
        )}
      </CenterModal>
      <CenterModal open={!!gaps} onClose={() => setGaps(null)} title="Some chapters have nothing to be written from">
        <p className="text-sm text-ink mb-2">Nothing in your files or answers covers:</p>
        <ul className="list-disc pl-5 text-sm text-ink mb-4 space-y-0.5">{(gaps || []).map((g) => <li key={g}>{g}</li>)}</ul>
        <p className="text-sm text-muted mb-4">You can add what is missing first, or go ahead: those chapters will be left out, not invented, and you can write them later.</p>
        <div className="flex flex-wrap gap-2">
          <Button className="flex-1 min-h-[44px]" onClick={() => { setGaps(null); setStep("sections"); }}>Add what is missing</Button>
          <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={() => run({ kind: "generate", proceed_with_gaps: true })}>Write the rest now</Button>
        </div>
      </CenterModal>
      <CenterModal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this project?" width="max-w-sm">
        <p className="text-sm text-muted mb-5">"{p.title}", its uploaded files and every built version will be removed for good. This can't be undone.</p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1 min-h-[44px]" onClick={() => setConfirmDelete(false)}>Cancel</Button>
          <Button variant="danger" className="flex-1 min-h-[44px]" onClick={async () => { try { await api.deleteProject(id); push("Project deleted"); router.push(pathname); } catch (e: any) { push(e?.detail || "Could not delete.", "error"); } }}>Delete</Button>
        </div>
      </CenterModal>
    </div>
  );
}
