"use client";

import { useRef, useState } from "react";
import { Download, ExternalLink, FileText, Loader2, MessageSquare, Paperclip, Presentation, RefreshCw, Send, Upload, X } from "lucide-react";
import { Badge, Button } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { api, fetchFile, saveFile } from "@/lib/api";
import { AREA, INPUT } from "@/components/projects/shared";

export type SubmissionFile = { index: number; name: string; size: number; kind: "report" | "presentation" };
export type Reply = { id: number; author: string; role: string; body: string; when: string | null };
export type Submission = {
  id: number; project_id: number; project_title: string; number: number; note: string;
  status: "submitted" | "under_review" | "changes_requested" | "reviewed";
  guide: { id: number; name: string } | null; files: SubmissionFile[];
  submitted: string | null; reviewed: string | null; unread: boolean; replies: Reply[];
};

export const STATUS: Record<Submission["status"], { label: string; tone: "info" | "warning" | "danger" | "success" }> = {
  submitted: { label: "Submitted", tone: "info" },
  under_review: { label: "Under review", tone: "warning" },
  changes_requested: { label: "Corrections requested", tone: "danger" },
  reviewed: { label: "Reviewed", tone: "success" },
};

// The same limits the server checks; checked here first so the student hears at once.
const ALLOWED = [".pdf", ".docx", ".ppt", ".pptx"];
const MAX_FILES = 5;
const MAX_MB = 20;
const MAX_NOTE = 2000;
const NOTE_EXAMPLE = "Sir/Madam, I have completed my project report. Please review the attached document and suggest any corrections.";

const size = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const extension = (name: string) => (name.match(/\.[^.]+$/)?.[0] || "").toLowerCase();
const newToken = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/** A PDF opens in a new tab; other files are downloaded. */
export async function openFile(path: string, name: string) {
  if (extension(name) !== ".pdf") return saveFile(path);
  const tab = window.open("", "_blank");            // opened now, while the click still counts, then pointed at the file
  try {
    const { blob } = await fetchFile(path);
    const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
    if (tab) tab.location.href = url; else window.location.assign(url);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/** The files, note and replies of one submission, as both the student and the guide see them. */
export function SubmissionCard({ sub, filePath, viewer, children }: { sub: Submission; filePath: (index: number) => string; viewer: "student" | "guide"; children?: React.ReactNode }) {
  const { push } = useToast();
  const status = STATUS[sub.status] || STATUS.submitted;
  const fresh = viewer === "student" && sub.unread;      // "new reply" is the student's marker
  return (
    <div className={`rounded-2xl border p-4 ${fresh ? "border-brand/40 bg-brand-50/40" : "border-gray-100"}`}>
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink break-words">{sub.project_title} <span className="text-muted font-normal">· Submission {sub.number}</span></div>
          <div className="text-xs text-muted mt-0.5">
            {[viewer === "student" && sub.guide ? `To ${sub.guide.name}` : null, sub.submitted ? `Sent ${sub.submitted}` : null, sub.reviewed ? `Replied ${sub.reviewed}` : null].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {fresh && <Badge tone="brand">New reply</Badge>}
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5">
        {sub.files.map((f) => (
          <li key={f.index} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2">
            {f.kind === "presentation" ? <Presentation size={16} className="text-brand shrink-0" /> : <FileText size={16} className="text-brand shrink-0" />}
            <span className="flex-1 min-w-0 text-sm text-ink break-words">{f.name}</span>
            <span className="text-xs text-muted shrink-0">{size(f.size)}</span>
            {extension(f.name) === ".pdf" && (
              <button aria-label={`Open ${f.name}`} onClick={() => openFile(filePath(f.index), f.name).catch(() => push("Could not open the file.", "error"))} className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-brand hover:bg-brand-light shrink-0"><ExternalLink size={15} /></button>
            )}
            <button aria-label={`Download ${f.name}`} onClick={() => saveFile(filePath(f.index)).catch(() => push("Could not download the file.", "error"))} className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-brand hover:bg-brand-light shrink-0"><Download size={15} /></button>
          </li>
        ))}
      </ul>

      {sub.note && (
        <div className="mt-3">
          <div className="text-xs font-medium text-muted mb-1">{viewer === "student" ? "Your note" : "Student's note"}</div>
          <p className="text-sm text-ink whitespace-pre-wrap break-words rounded-xl border border-gray-100 px-3 py-2">{sub.note}</p>
        </div>
      )}

      {sub.replies.length > 0 && (
        <ul className="mt-3 space-y-2">
          {sub.replies.map((r) => (
            <li key={r.id} className={`rounded-xl p-3 ${r.role === "teacher" ? "bg-brand-50 border border-brand/10" : "border border-gray-100"}`}>
              <div className="flex items-center gap-1.5 flex-wrap text-xs text-muted"><MessageSquare size={13} /> {r.author} · {r.role === "teacher" ? "Guide" : viewer === "student" ? "You" : "Student"}{r.when ? ` · ${r.when}` : ""}</div>
              <p className="text-sm text-ink mt-1 whitespace-pre-wrap break-words">{r.body}</p>
            </li>
          ))}
        </ul>
      )}
      {children}
    </div>
  );
}

/** The student's history: every submission with the guide's replies, a reply box, and "send a revised version". */
export function StudentSubmissions({ subs, onChanged, onRevise }: { subs: Submission[]; onChanged: () => void; onRevise: (sub: Submission) => void }) {
  const { push } = useToast();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [sending, setSending] = useState<number | null>(null);
  const reply = async (sub: Submission) => {
    const body = (drafts[sub.id] || "").trim();
    if (body.length < 2 || sending) return;
    setSending(sub.id);
    try {
      await api.commentOnProject(sub.project_id, "general", body, sub.id);
      setDrafts({ ...drafts, [sub.id]: "" });
      push("Sent to your guide.");
      onChanged();
    } catch (e: any) { push(e?.detail || "Could not send.", "error"); }
    setSending(null);
  };
  return (
    <div className="space-y-3">
      {subs.map((sub) => (
        <SubmissionCard key={sub.id} sub={sub} viewer="student" filePath={(i) => `/student/project-submissions/${sub.id}/files/${i}`}>
          <div className="mt-3 flex flex-col sm:flex-row gap-2">
            {sub.replies.length > 0 && (
              <div className="flex gap-2 flex-1">
                <label htmlFor={`sr-${sub.id}`} className="sr-only">Reply to your guide about submission {sub.number}</label>
                <input id={`sr-${sub.id}`} value={drafts[sub.id] || ""} maxLength={2000} onChange={(e) => setDrafts({ ...drafts, [sub.id]: e.target.value })} placeholder="Reply to your guide" className={INPUT} />
                <Button className="min-h-[44px] shrink-0" disabled={(drafts[sub.id] || "").trim().length < 2 || sending === sub.id} onClick={() => reply(sub)}>{sending === sub.id ? <Loader2 size={15} className="animate-spin" /> : "Send"}</Button>
              </div>
            )}
            {sub.status === "changes_requested" && (
              <Button variant="secondary" className="min-h-[44px] shrink-0" onClick={() => onRevise(sub)}><RefreshCw size={14} /> Send a revised version</Button>
            )}
          </div>
        </SubmissionCard>
      ))}
    </div>
  );
}

type Project = { id: number; title: string };
type Guide = { id: number; name: string; designation?: string | null };

/** Upload ready-made documents, choose the guide, write a note, submit. */
export function SubmissionForm({ projects, guides, preset, onDone }: {
  projects: Project[]; guides: Guide[]; preset?: { projectId?: number; guideId?: number }; onDone: (sub: Submission) => void;
}) {
  const { push } = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [projectId, setProjectId] = useState<string>(preset?.projectId ? String(preset.projectId) : projects.length ? String(projects[0].id) : "new");
  const [title, setTitle] = useState("");
  const [guideId, setGuideId] = useState<string>(preset?.guideId ? String(preset.guideId) : "");
  const [note, setNote] = useState(NOTE_EXAMPLE);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const token = useRef(newToken());        // one per submission: a repeated click is recognised by the server

  const add = (list: FileList | null) => {
    if (!list) return;
    const problems: string[] = [];
    const next = [...files];
    Array.from(list).forEach((f) => {
      if (!ALLOWED.includes(extension(f.name))) problems.push(`"${f.name}" is not a PDF, Word (.docx) or PowerPoint (.ppt, .pptx) file.`);
      else if (f.size === 0) problems.push(`"${f.name}" is empty.`);
      else if (f.size > MAX_MB * 1024 * 1024) problems.push(`"${f.name}" is larger than ${MAX_MB} MB.`);
      else {
        const same = next.findIndex((x) => x.name === f.name);
        if (same >= 0) next[same] = f;                                  // the same name again replaces the earlier one
        else if (next.length >= MAX_FILES) problems.push(`Attach up to ${MAX_FILES} files at a time.`);
        else next.push(f);
      }
    });
    setFiles(next);
    setErrors({ ...errors, files: problems.filter((p, i, a) => a.indexOf(p) === i).join(" ") });
    if (picker.current) picker.current.value = "";
  };

  const submit = async () => {
    if (busy) return;
    const found: Record<string, string> = {};
    if (!files.length) found.files = "Attach your report or presentation.";
    if (!guideId) found.guide = "Choose the guide to send it to.";
    if (projectId === "new" && (title.trim().length < 5 || title.trim().length > 200)) found.title = "Give the project title (5 to 200 characters).";
    if (note.length > MAX_NOTE) found.note = `Keep the note to ${MAX_NOTE} characters.`;
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true);
    try {
      const sub = await api.submitToGuide({
        guide_id: Number(guideId), note: note.trim(), client_token: token.current,
        ...(projectId === "new" ? { title: title.trim() } : { project_id: Number(projectId) }),
      }, files);
      token.current = newToken();
      setFiles([]);
      setTitle("");
      push(`Submitted to ${sub.guide?.name || "your guide"}. They have been notified.`);
      onDone(sub);
    } catch (e: any) {
      push(e?.detail || "Could not submit. Check your connection and try again.", "error");
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ds-project" className="text-xs font-medium text-muted mb-1 block">Project</label>
        <select id="ds-project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={INPUT}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          <option value="new">A new project (type its title)</option>
        </select>
        {projectId === "new" && (
          <input aria-label="Project title" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Smart Attendance System Using Face Recognition" className={`${INPUT} mt-2`} />
        )}
        {errors.title && <p className="text-xs text-danger mt-1">{errors.title}</p>}
      </div>

      <div>
        <span className="text-xs font-medium text-muted mb-1 block">Report and presentation</span>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
          className={`rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${dragging ? "border-brand bg-brand-50" : "border-gray-200"}`}
        >
          <Upload size={20} className="text-brand mx-auto" />
          <p className="text-sm text-ink mt-2">Drop your files here, or</p>
          <Button variant="secondary" className="min-h-[44px] mt-2" onClick={() => picker.current?.click()}><Paperclip size={14} /> Choose files</Button>
          <p className="text-xs text-muted mt-2">Report as PDF or Word (.docx), slides as .pptx or .ppt. Up to {MAX_FILES} files, {MAX_MB} MB each.</p>
          <input ref={picker} type="file" multiple accept=".pdf,.docx,.ppt,.pptx" className="sr-only" aria-label="Choose files" onChange={(e) => add(e.target.files)} />
        </div>
        {files.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-2 rounded-xl bg-gray-50 px-3 py-2">
                {[".ppt", ".pptx"].includes(extension(f.name)) ? <Presentation size={16} className="text-brand shrink-0" /> : <FileText size={16} className="text-brand shrink-0" />}
                <span className="flex-1 min-w-0 text-sm text-ink break-words">{f.name}</span>
                <span className="text-xs text-muted shrink-0">{size(f.size)}</span>
                <button aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))} className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-muted hover:text-danger hover:bg-danger/10 shrink-0"><X size={15} /></button>
              </li>
            ))}
          </ul>
        )}
        {errors.files && <p className="text-xs text-danger mt-1">{errors.files}</p>}
      </div>

      <div>
        <label htmlFor="ds-guide" className="text-xs font-medium text-muted mb-1 block">Guide</label>
        <select id="ds-guide" value={guideId} onChange={(e) => setGuideId(e.target.value)} className={INPUT}>
          <option value="">Choose your guide</option>
          {guides.map((g) => <option key={g.id} value={g.id}>{g.name}{g.designation ? ` (${g.designation})` : ""}</option>)}
        </select>
        {guides.length === 0 && <p className="text-xs text-muted mt-1">No faculty are listed for your department yet. Ask your department office.</p>}
        {errors.guide && <p className="text-xs text-danger mt-1">{errors.guide}</p>}
      </div>

      <div>
        <label htmlFor="ds-note" className="text-xs font-medium text-muted mb-1 block">Note to your guide</label>
        <textarea id="ds-note" rows={4} value={note} maxLength={MAX_NOTE} onChange={(e) => setNote(e.target.value)} className={AREA} />
        <div className="flex justify-between text-xs mt-1">
          <span className="text-danger">{errors.note}</span>
          <span className="text-muted">{note.length}/{MAX_NOTE}</span>
        </div>
      </div>

      <Button className="w-full sm:w-auto min-h-[44px]" disabled={busy} onClick={submit}>
        {busy ? <><Loader2 size={15} className="animate-spin" /> Submitting…</> : <><Send size={15} /> Submit to Guide</>}
      </Button>
    </div>
  );
}
