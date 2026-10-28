"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Download, FileText, MessageSquare } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api, saveFile } from "@/lib/api";
import { AREA, DraftView, INPUT, PagePreview } from "@/components/projects/shared";
import { Submission, SubmissionCard } from "@/components/projects/DirectSubmission";

/** The guide's reply to one submitted document: a comment plus the outcome. */
function SubmissionReply({ projectId, sub, onSent }: { projectId: number; sub: Submission; onSent: () => void }) {
  const { push } = useToast();
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<"reviewed" | "changes_requested">("changes_requested");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (busy || body.trim().length < 2) return;
    setBusy(true);
    try {
      await api.guideComment(projectId, "general", body, { id: sub.id, status: outcome });
      setBody("");
      push("Reply sent. The student has been notified.");
      onSent();
    } catch (e: any) { push(e?.detail || "Could not send the reply.", "error"); }
    setBusy(false);
  };
  return (
    <div className="mt-3 space-y-2">
      <label htmlFor={`sb-${sub.id}`} className="text-xs font-medium text-muted block">Your reply about submission {sub.number}</label>
      <textarea id={`sb-${sub.id}`} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Feedback, notes or corrections for the student" className={AREA} />
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label htmlFor={`so-${sub.id}`} className="sr-only">Outcome</label>
        <select id={`so-${sub.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} className="border border-gray-200 bg-white rounded-xl px-3 min-h-[44px] text-sm text-ink">
          <option value="changes_requested">Corrections needed</option>
          <option value="reviewed">Reviewed, no corrections</option>
        </select>
        <Button className="min-h-[44px]" disabled={busy || body.trim().length < 2} onClick={send}>{busy ? "Sending…" : "Send reply"}</Button>
      </div>
    </div>
  );
}

const FILE_LABELS: Record<string, string> = { report_docx: "Report (.docx)", report_pdf: "Report (.pdf)", ppt_pptx: "PPT (.pptx)", ppt_pdf: "PPT (.pdf)" };

export default function ProjectReviewsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const id = Number(useSearchParams().get("id")) || null;
  const { push } = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [project, setProject] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [section, setSection] = useState("general");
  const [body, setBody] = useState("");
  const [view, setView] = useState<"report" | "slides">("report");

  const load = () => {
    setFailed(false);
    if (id) { setProject(null); api.projectReview(id).then(setProject).catch(() => setFailed(true)); }
    else api.projectReviews().then(setRows).catch(() => setFailed(true));
  };
  useEffect(load, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const heading = "Project Reviews";
  if (failed) return <><Topbar greeting={heading} subtitle="Projects shared with you" avatarLetter="T" /><LoadError message={id ? "This project is not shared with you, or no longer exists." : "We couldn't load the projects shared with you."} onRetry={load} /></>;

  if (id) {
    if (!project) return <><Topbar greeting={heading} subtitle="Loading…" avatarLetter="T" /><DashboardSkeleton /></>;
    const latest = project.versions[0];
    const send = async () => {
      try {
        await api.guideComment(id, section, body);
        setBody("");
        push("Comment sent. The student has been notified.");
        load();
      } catch (e: any) { push(e?.detail || "Could not send the comment.", "error"); }
    };
    return (
      <>
        <Topbar greeting={project.title} subtitle={`Dashboard > Project Reviews`} avatarLetter="T" />
        <div className="p-4 md:p-8 space-y-5">
          <button onClick={() => router.push(pathname)} className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-brand hover:underline"><ArrowLeft size={15} /> All shared projects</button>
          {project.submissions.length > 0 && (
            <Card>
              <SectionTitle title="Documents submitted to you" subtitle={project.submitted_by ? `From ${project.submitted_by.name} (${project.submitted_by.usn}), batch ${project.submitted_by.batch}${project.submitted_by.semester ? `, semester ${project.submitted_by.semester}` : ""}` : undefined} />
              <div className="space-y-3">
                {project.submissions.map((sub: Submission) => (
                  <SubmissionCard key={sub.id} sub={sub} viewer="guide" filePath={(i) => `/teacher/project-reviews/${id}/submissions/${sub.id}/files/${i}`}>
                    <SubmissionReply projectId={id} sub={sub} onSent={load} />
                  </SubmissionCard>
                ))}
              </div>
            </Card>
          )}
          {/* The builder's draft, files and section comments: hidden when the project only has documents submitted directly. */}
          {project.current_guide && (project.versions.length > 0 || project.content.chapters.length > 0 || project.content.slides.length > 0
            || project.comments.some((c: any) => !c.submission_id) || project.submissions.length === 0) && <>
          <Card>
            <SectionTitle title={project.title} subtitle={[project.project_type, project.students.map((s: any) => `${s.name} (${s.usn})`).join(", ")].filter(Boolean).join(" · ")} />
            {latest ? (
              <div className="flex flex-wrap gap-2">
                {latest.files.map((f: string) => (
                  <Button key={f} variant="secondary" className="min-h-[44px]" onClick={() => saveFile(`/teacher/project-reviews/${id}/versions/${latest.number}/${f}`).catch(() => push("Could not download.", "error"))}><Download size={14} /> {FILE_LABELS[f] || f}</Button>
                ))}
                <span className="text-xs text-muted self-center">Version {latest.number}, built {latest.created}</span>
              </div>
            ) : <p className="text-sm text-muted">{project.submissions.length ? "The student has not built files with the report builder. Their submitted documents are above." : "The student has not built the files yet. The draft is below."}</p>}
          </Card>

          <Card>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h3 className="text-lg font-semibold text-ink">{latest?.files.includes(view === "report" ? "report_pdf" : "ppt_pdf") ? "As it will be submitted" : "Draft"}</h3>
              <div role="tablist" aria-label="View" className="flex gap-1 bg-gray-100 rounded-xl p-1">
                {(["report", "slides"] as const).map((k) => <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`px-3 min-h-[40px] rounded-lg text-xs font-semibold ${view === k ? "bg-brand text-white" : "text-muted"}`}>{k === "report" ? "Report" : "Slides"}</button>)}
              </div>
            </div>
            {latest?.files.includes(view === "report" ? "report_pdf" : "ppt_pdf")
              ? <PagePreview base={`/teacher/project-reviews/${id}/versions/${latest.number}/pages/${view}`} label={view === "report" ? "page" : "slide"} wide={view === "slides"} />
              : <DraftView draft={project.content} imagePath={(imageId) => `/teacher/project-reviews/${id}/images/${imageId}`} only={view} />}
          </Card>

          <Card>
            <SectionTitle title="Comments" subtitle="The student sees each comment against the section you choose and is notified." />
            {project.comments.filter((c: any) => !c.submission_id).length === 0 ? <p className="text-sm text-muted mb-3">No comments yet.</p> : (
              <ul className="space-y-2 mb-4">
                {project.comments.filter((c: any) => !c.submission_id).map((c: any) => (
                  <li key={c.id} className={`rounded-xl border border-gray-100 p-3 ${c.resolved ? "opacity-60" : ""}`}>
                    <div className="flex items-center gap-2 flex-wrap text-xs text-muted"><MessageSquare size={13} /> {c.author} · {c.role === "teacher" ? "Guide" : "Student"} · {c.section} · {c.when}{c.resolved && <Badge tone="success">Marked done by the student</Badge>}</div>
                    <p className="text-sm text-ink mt-1 whitespace-pre-wrap break-words">{c.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <div className="space-y-2 max-w-2xl">
              <label htmlFor="gc-section" className="text-xs font-medium text-muted block">About</label>
              <select id="gc-section" value={section} onChange={(e) => setSection(e.target.value)} className={INPUT}>
                <option value="general">The project as a whole</option>
                <option value="Abstract">Abstract</option>
                {project.content.chapters.map((c: any, i: number) => <option key={c.key + i} value={`Chapter ${i + 1}: ${c.title}`}>Chapter {i + 1}: {c.title}</option>)}
                <option value="Slides">Slides</option>
                <option value="References">References</option>
              </select>
              <label htmlFor="gc-body" className="text-xs font-medium text-muted block">Comment</label>
              <textarea id="gc-body" rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} className={AREA} />
              <Button className="min-h-[44px]" disabled={body.trim().length < 2} onClick={send}>Send comment</Button>
            </div>
          </Card>
          </>}
        </div>
      </>
    );
  }

  if (!rows) return <><Topbar greeting={heading} subtitle="Loading…" avatarLetter="T" /><DashboardSkeleton /></>;
  return (
    <>
      <Topbar greeting={heading} subtitle="Dashboard > Project Reviews" avatarLetter="T" />
      <div className="p-4 md:p-8 max-w-4xl">
        <Card className="!p-0 overflow-hidden">
          <div className="px-5 pt-5"><SectionTitle title="Shared with you" subtitle="Projects shared with you from the report builder, and reports or PPTs students submitted to you directly. You can read, download and reply." /></div>
          {rows.length === 0 ? (
            <EmptyState icon={FileText} title="Nothing shared with you yet" hint="When a student you guide shares their project or submits a report or PPT to you, it appears here and you get a notification." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => router.push(`${pathname}?id=${r.id}`)} className="w-full flex items-center gap-3 px-5 py-3 min-h-[60px] text-left hover:bg-gray-50 outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink break-words">{r.title}</div>
                      <div className="text-xs text-muted">{[r.students.map((s: any) => s.name).join(", "), r.project_type, r.last_submitted ? `Submitted ${r.last_submitted}` : r.updated ? `Updated ${r.updated}` : null].filter(Boolean).join(" · ")}</div>
                    </div>
                    {r.awaiting_review > 0 && <Badge tone="info">{r.awaiting_review} to review</Badge>}
                    {r.open_comments > 0 && <Badge tone="warning">{r.open_comments} open</Badge>}
                    {r.latest_version ? <Badge tone="success">{`Version ${r.latest_version}`}</Badge>
                      : r.submissions ? <Badge tone="neutral">{`${r.submissions} submitted`}</Badge>
                      : <Badge tone="neutral">Draft only</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
