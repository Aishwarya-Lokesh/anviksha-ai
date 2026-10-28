"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Plus, Send, Sparkles, X } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";
import { INPUT } from "@/components/projects/shared";
import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace";
import { StudentSubmissions, Submission, SubmissionForm } from "@/components/projects/DirectSubmission";

type Row = { id: number; title: string; project_type: string | null; versions: number; submissions?: number; updated: string | null };

export default function ProjectPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const id = Number(params.get("id")) || null;
  const { push } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [subs, setSubs] = useState<Submission[] | null>(null);
  const [guides, setGuides] = useState<any[]>([]);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Final year project");
  const [types, setTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(params.get("submit") === "1");
  const [preset, setPreset] = useState<{ projectId?: number; guideId?: number }>({});
  const [formKey, setFormKey] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);

  const load = () => {
    setFailed(false);
    api.myProjects().then(setRows).catch(() => setFailed(true));
    api.mySubmissions().then((list: Submission[]) => {
      setSubs(list);
      // Shown now, so marked as read; the "New reply" marks stay on screen until the next visit.
      if (list.some((s) => s.unread)) api.markSubmissionsSeen().catch(() => {});
    }).catch(() => setSubs([]));
  };
  useEffect(() => {
    if (id) return;
    load();
    api.projectStart().then((s) => { setTypes(s.project_types || []); setGuides(s.guides || []); }).catch(() => {});
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const openForm = (next: { projectId?: number; guideId?: number } = {}) => {
    setPreset(next);
    setFormKey((k) => k + 1);
    setSubmitting(true);
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const made = await api.createProject({ title, details: { project_type: type } });
      setCreating(false);
      setTitle("");
      router.push(`${pathname}?id=${made.id}`);
    } catch (e: any) {
      push(e?.detail || "Could not create the project.", "error");
    }
    setBusy(false);
  };

  const heading = "Project Report & PPT";
  if (id) return <><Topbar greeting={heading} subtitle="Dashboard > Project Report & PPT" avatarLetter="S" /><ProjectWorkspace id={id} /></>;
  if (failed) return <><Topbar greeting={heading} subtitle="In your college's format" avatarLetter="S" /><LoadError message="We couldn't load your projects." onRetry={load} /></>;
  if (!rows) return <><Topbar greeting={heading} subtitle="Loading…" avatarLetter="S" /><DashboardSkeleton /></>;

  const unread = (subs || []).filter((s) => s.unread).length;

  return (
    <>
      <Topbar greeting={heading} subtitle="Dashboard > Project Report & PPT" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-5 max-w-4xl">
        <div className="grid gap-3 sm:grid-cols-2">
          <Card className="flex flex-col">
            <div className="flex items-center gap-2 text-xs font-semibold text-brand"><Sparkles size={14} /> Option A</div>
            <h2 className="text-base font-semibold text-ink mt-1">Generate a new report</h2>
            <p className="text-sm text-muted mt-1 flex-1">Give your project's details and your own material, step by step. You get the report and the presentation in the official format, as Word, PowerPoint and PDF, and can share them with your guide.</p>
            <Button className="min-h-[44px] mt-3 self-start" onClick={() => setCreating(true)}><Plus size={15} /> New project</Button>
          </Card>
          <Card className="flex flex-col">
            <div className="flex items-center gap-2 text-xs font-semibold text-brand"><Send size={14} /> Option B</div>
            <h2 className="text-base font-semibold text-ink mt-1">Submit existing documents</h2>
            <p className="text-sm text-muted mt-1 flex-1">Already have your report or PPT ready? Upload it, choose your guide, add a note and send it straight away. No steps to go through.</p>
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <Button className="min-h-[44px]" onClick={() => (submitting ? setSubmitting(false) : openForm())}><Send size={15} /> Submit Existing Project Documents</Button>
              {unread > 0 && <Badge tone="brand">{unread} new {unread === 1 ? "reply" : "replies"}</Badge>}
            </div>
          </Card>
        </div>

        {submitting && (
          <div ref={formRef} className="scroll-mt-4">
            <Card>
              <SectionTitle title="Direct submission to guide" subtitle="Your guide sees the files and your note on their Project Reviews page and is notified."
                action={<button aria-label="Close" onClick={() => setSubmitting(false)} className="inline-flex items-center justify-center w-10 h-10 rounded-lg text-muted hover:bg-gray-100"><X size={16} /></button>} />
              <SubmissionForm key={formKey} projects={rows.map((r) => ({ id: r.id, title: r.title }))} guides={guides} preset={preset}
                onDone={() => { setSubmitting(false); load(); }} />
            </Card>
          </div>
        )}

        {subs && subs.length > 0 && (
          <Card>
            <SectionTitle title="Submitted to your guide" subtitle="Each document you sent, its status, and your guide's replies." />
            <StudentSubmissions subs={subs} onChanged={load} onRevise={(s) => openForm({ projectId: s.project_id, guideId: s.guide?.id })} />
          </Card>
        )}

        <Card className="!p-0 overflow-hidden">
          <div className="px-5 pt-5"><SectionTitle title="My projects" /></div>
          {rows.length === 0 ? (
            <EmptyState icon={FileText} title="No project yet" hint="Start one for your mini project or final year project, or submit documents you already have. Only you can see a project until you share it with your guide." action={<Button className="min-h-[44px]" onClick={() => setCreating(true)}><Plus size={15} /> Start a project</Button>} />
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => router.push(`${pathname}?id=${r.id}`)} className="w-full flex items-center gap-3 px-5 py-3 min-h-[60px] text-left hover:bg-gray-50 outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                    <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center shrink-0"><FileText size={18} className="text-brand" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink break-words">{r.title}</div>
                      <div className="text-xs text-muted">{[r.project_type, r.updated ? `Updated ${r.updated}` : null].filter(Boolean).join(" · ")}</div>
                    </div>
                    {r.versions > 0 ? <Badge tone="success">{`${r.versions} version${r.versions === 1 ? "" : "s"}`}</Badge>
                      : r.submissions ? <Badge tone="info">{`${r.submissions} submitted`}</Badge>
                      : <Badge tone="neutral">Not built yet</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CenterModal open={creating} onClose={() => !busy && setCreating(false)} title="New project">
        <div className="space-y-3">
          <div>
            <label htmlFor="np-title" className="text-xs font-medium text-muted mb-1 block">Project title</label>
            <input id="np-title" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Smart Attendance System Using Face Recognition" className={INPUT} />
          </div>
          <div>
            <label htmlFor="np-type" className="text-xs font-medium text-muted mb-1 block">Project type</label>
            <select id="np-type" value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
              {(types.length ? types : [type]).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Button className="w-full min-h-[44px]" disabled={busy || title.trim().length < 5} onClick={create}>{busy ? "Creating…" : "Create and continue"}</Button>
        </div>
      </CenterModal>
    </>
  );
}
