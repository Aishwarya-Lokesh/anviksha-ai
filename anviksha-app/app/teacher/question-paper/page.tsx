"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { Check, Download, FileQuestion, FileText, History, Loader2, Pencil, Plus, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { PillNav } from "@/components/ui/Tabs";
import { EmptyState } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";
import { useProfile } from "@/lib/useProfile";
import { downloadQuestionPaperDOCX, downloadQuestionPaperPDF, PaperDetails, rbtLevel } from "@/lib/questionPaperExport";

type Slot = { question_type: string; marks: number; co: string; or_after?: boolean };
type Part = { name: string; questions: Slot[] };
type SourceDoc = { id: number; filename: string; kind: "notes" | "important_questions"; uploaded_at?: string | null };

const BLOOM_LEVELS = ["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create", "Any"];
const BLOOM_COLOR: Record<string, string> = { Remember: "#6B7280", Understand: "#3B82F6", Apply: "#1F9D55", Analyze: "#E8A93B", Evaluate: "#F97316", Create: "#5B3FD9" };
const SOURCE_LABEL: Record<string, string> = { extracted: "From your source files", paraphrased: "Reworded by AI", ai_generated: "Written by AI — review", missing: "Not filled — type it in", edited: "Edited by you" };
const EXAMS = ["Internal Assessment Test – 1", "Internal Assessment Test – 2", "Internal Assessment Test – 3", "Semester End Examination", "Model Examination"];
const input = "w-full rounded-xl border border-gray-200 px-3 min-h-[44px] text-sm outline-none focus:ring-2 focus:ring-brand/30 bg-white";
const label = "text-xs font-medium text-muted mb-1 block";

const slot = (question_type: string, marks: number, co: string, or_after = false): Slot => ({ question_type, marks, co, or_after });
// A common internal-assessment shape: two parts, each a pair of alternatives worth 25.
const DEFAULT_PARTS: Part[] = [
  { name: "PART A", questions: [slot("Understand", 10, "CO1"), slot("Apply", 15, "CO1", true), slot("Understand", 10, "CO1"), slot("Apply", 15, "CO2")] },
  { name: "PART B", questions: [slot("Apply", 10, "CO2"), slot("Analyze", 15, "CO2", true), slot("Apply", 10, "CO3"), slot("Analyze", 15, "CO3")] },
];

function academicYear() {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}–${String(start + 1).slice(2)}`;
}

export default function QuestionPaperPage() {
  const { push } = useToast();
  const profile = useProfile();
  const [subjects, setSubjects] = useState<any[]>([]);
  const [details, setDetails] = useState<PaperDetails>({
    college_name: "GSSS Institute of Engineering and Technology for Women, Mysuru", department: "", exam_name: EXAMS[0],
    academic_year: academicYear(), semester: "", subject_name: "", subject_code: "", exam_date: "", duration: "1 Hour 30 Minutes",
    total_marks: "50", faculty_name: "", instructions: "Answer one full question from each part.", custom_header_image: undefined,
  });
  const [docs, setDocs] = useState<SourceDoc[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState<string | null>(null);
  const [parts, setParts] = useState<Part[]>(DEFAULT_PARTS);
  const [result, setResult] = useState<{ set_a?: any[]; set_b?: any[]; validation?: any; sources?: any } | null>(null);
  const [tab, setTab] = useState<"A" | "B">("A");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);      // "A-0-1" while one question is being replaced
  const [editing, setEditing] = useState<string | null>(null);
  const [saved, setSaved] = useState<any[] | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);

  const set = (patch: Partial<PaperDetails>) => setDetails((d) => ({ ...d, ...patch }));
  const configured = parts.reduce((sum, p) => sum + p.questions.reduce((m, q) => m + (Number(q.marks) || 0), 0), 0);

  useEffect(() => {
    api.teacherSubjects().then(setSubjects).catch(() => setSubjects([]));
    api.listQuestionPaperDocuments().then((rows: SourceDoc[]) => setDocs(rows)).catch(() => setDocs([]));
    api.listQuestionPapers().then(setSaved).catch(() => setSaved([]));
  }, []);

  // Fill in who is setting the paper, once known, without overwriting what they typed.
  useEffect(() => {
    if (!profile) return;
    setDetails((d) => ({ ...d, faculty_name: d.faculty_name || profile.name || "", department: d.department || profile.details?.department || "" }));
  }, [profile]);

  const chooseSubject = (id: string) => {
    const s = subjects.find((x) => String(x.id) === id);
    if (s) set({ subject_name: s.name, subject_code: s.code, semester: s.semester ? String(s.semester) : details.semester });
  };

  const upload = async (kind: SourceDoc["kind"], event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    for (const file of files) {
      setUploading(file.name);
      try {
        const doc = await api.uploadQuestionPaperDocument(kind, file);
        setDocs((old) => [{ ...doc, uploaded_at: null }, ...old]);
        setSelected((old) => new Set(old).add(doc.id));
        push(`${file.name} added`);
      } catch (e: any) {
        push(e?.message || `Could not read ${file.name}`, "error");
      }
    }
    setUploading(null);
  };

  const removeDoc = async (doc: SourceDoc) => {
    try {
      await api.deleteQuestionPaperDocument(doc.id);
      setDocs((old) => old.filter((d) => d.id !== doc.id));
      setSelected((old) => { const next = new Set(old); next.delete(doc.id); return next; });
    } catch {
      push("Could not remove that file. Please try again.", "error");
    }
  };

  const toggleDoc = (id: number) => setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const idsOf = (kind: SourceDoc["kind"]) => docs.filter((d) => d.kind === kind && selected.has(d.id)).map((d) => d.id);
  const settings = () => ({ ...details, total_marks: Number(details.total_marks) || 0, structure: parts });

  const updateSlot = (pi: number, qi: number, patch: Partial<Slot>) =>
    setParts((old) => old.map((p, i) => (i === pi ? { ...p, questions: p.questions.map((q, j) => (j === qi ? { ...q, ...patch } : q)) } : p)));

  const generate = async () => {
    if (!details.subject_name.trim()) return push("Choose or type the subject first.", "error");
    if (!parts.length || parts.some((p) => !p.questions.length)) return push("Every part needs at least one question.", "error");
    if (parts.some((p) => p.questions.some((q) => !(q.marks > 0)))) return push("Every question needs marks greater than zero.", "error");
    if (!(Number(details.total_marks) > 0)) return push("Enter the maximum marks.", "error");
    setLoading(true);
    try {
      const data = await api.generateQuestionPaper({ settings: settings(), note_ids: idsOf("notes"), important_question_ids: idsOf("important_questions") });
      setResult(data);
      setTab("A");
      setEditing(null);
      push("Set A and Set B generated. Review, edit or replace any question before saving.");
    } catch (e: any) {
      push(e?.detail || "Could not generate the paper. Please try again.", "error");
    }
    setLoading(false);
  };

  const key = tab === "A" ? "set_a" : "set_b";
  const paper: any[] | undefined = result?.[key];
  const validation = result?.validation?.[key] ?? (result?.validation?.questions_total != null ? result.validation : null);

  const patchQuestion = (pi: number, qi: number, patch: any) =>
    setResult((r) => (r ? { ...r, [key]: (r as any)[key].map((p: any, i: number) => (i === pi ? { ...p, questions: p.questions.map((q: any, j: number) => (j === qi ? { ...q, ...patch } : q)) } : p)) } : r));

  const replace = async (pi: number, qi: number) => {
    if (!result || !paper) return;
    const q = paper[pi].questions[qi];
    const id = `${tab}-${pi}-${qi}`;
    setBusy(id);
    try {
      const onPaper = [...(result.set_a || []), ...(result.set_b || [])].flatMap((p: any) => p.questions.map((x: any) => x.question)).filter(Boolean);
      const fresh = await api.replaceQuestionPaperQuestion({
        settings: settings(), note_ids: idsOf("notes"), important_question_ids: idsOf("important_questions"),
        spec: { question_type: q.bloom_level && BLOOM_LEVELS.includes(q.bloom_level) ? q.bloom_level : "Any", marks: q.marks, co: q.co, or_after: q.or_after },
        exclude: onPaper,
      });
      patchQuestion(pi, qi, fresh);
      push("Question replaced");
    } catch (e: any) {
      push(e?.detail || "No other question is available for this slot.", "error");
    }
    setBusy(null);
  };

  const save = async () => {
    if (!paper) return;
    try {
      await api.saveQuestionPaper({ title: `${details.subject_code || details.subject_name} — ${details.exam_name}`, set_label: tab, settings: settings(), paper, validation: result?.validation });
      setSaved(await api.listQuestionPapers());
      push(`Set ${tab} saved to your papers`);
    } catch (e: any) {
      push(e?.detail || "Could not save the paper. Please try again.", "error");
    }
  };

  const open = async (id: number) => {
    try {
      const p = await api.getQuestionPaper(id);
      const s = p.settings || {};
      setDetails((d) => ({ ...d, ...Object.fromEntries(Object.keys(d).filter((k) => s[k] != null).map((k) => [k, k === "total_marks" ? String(s[k]) : s[k]])) }));
      if (Array.isArray(s.structure) && s.structure.length) setParts(s.structure);
      setResult({ set_a: p.set_a, set_b: p.set_b, validation: p.validation });
      setTab(p.set_label);
      setEditing(null);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      push("Could not open that paper. Please try again.", "error");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.deleteQuestionPaper(deleteTarget.id);
      setSaved((old) => (old || []).filter((p) => p.id !== deleteTarget.id));
      push("Paper deleted");
    } catch {
      push("Could not delete that paper. Please try again.", "error");
    }
    setDeleteTarget(null);
  };

  const download = async (format: "pdf" | "docx") => {
    if (!paper) return;
    if (paper.some((p: any) => p.questions.some((q: any) => !q.question?.trim()))) return push("Fill in the empty question(s) before downloading.", "error");
    try {
      if (format === "pdf") downloadQuestionPaperPDF(details, paper, tab);
      else await downloadQuestionPaperDOCX(details, paper, tab);
    } catch {
      push("The file could not be created. Please try again.", "error");
    }
  };

  const liveMarks = useMemo(() => (paper || []).reduce((sum: number, p: any) => sum + p.questions.reduce((m: number, q: any) => m + (Number(q.marks) || 0), 0), 0), [paper]);
  let number = 0;

  return (
    <>
      <Topbar greeting="Question Paper Generator" subtitle="Dashboard > Question Paper Generator" avatarLetter="T" />
      <div className="p-4 md:p-8 grid xl:grid-cols-2 gap-6 items-start">
        <div className="space-y-6 min-w-0">
          <Card hover>
            <SectionTitle title="1. Source questions" subtitle="Questions are picked from these files and from the department's question bank for the subject" />
            <div className="grid sm:grid-cols-2 gap-3">
              {([["important_questions", "Question bank / previous papers"], ["notes", "Subject notes (optional)"]] as const).map(([kind, title]) => (
                <label key={kind} className="flex items-center gap-2 min-h-[56px] px-3 rounded-xl border border-dashed border-brand/40 text-sm font-medium text-brand cursor-pointer hover:bg-brand-light/50">
                  <Upload size={16} className="shrink-0" /> <span className="min-w-0">{title}</span>
                  <input type="file" multiple accept=".pdf,.docx" className="hidden" onChange={(e) => upload(kind, e)} />
                </label>
              ))}
            </div>
            {uploading && <p className="text-xs text-muted mt-2 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Reading {uploading}…</p>}
            {docs.length === 0 ? (
              <p className="text-xs text-muted mt-3">No files uploaded yet. You can still generate if the department's question bank has this subject.</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 rounded-xl bg-gray-50 pl-3 pr-1 min-h-[44px]">
                    <input id={`doc-${d.id}`} type="checkbox" checked={selected.has(d.id)} onChange={() => toggleDoc(d.id)} className="w-4 h-4 accent-brand shrink-0" />
                    <label htmlFor={`doc-${d.id}`} className="flex-1 min-w-0 text-sm text-ink truncate cursor-pointer">{d.filename}</label>
                    <Badge tone={d.kind === "notes" ? "info" : "brand"}>{d.kind === "notes" ? "Notes" : "Questions"}</Badge>
                    <button onClick={() => removeDoc(d)} aria-label={`Remove ${d.filename}`} className="w-11 h-11 flex items-center justify-center text-muted hover:text-danger shrink-0"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card hover>
            <SectionTitle title="2. Paper details" subtitle="Printed in the paper's heading" />
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="qp-subject-pick">Subject</label>
                <select id="qp-subject-pick" className={input} value={subjects.find((s) => s.code === details.subject_code)?.id ?? ""} onChange={(e) => chooseSubject(e.target.value)}>
                  <option value="">{subjects.length ? "Choose one of your subjects…" : "No subjects assigned — type it below"}</option>
                  {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                </select>
              </div>
              <div><label className={label} htmlFor="qp-name">Subject name</label><input id="qp-name" className={input} value={details.subject_name} onChange={(e) => set({ subject_name: e.target.value })} /></div>
              <div><label className={label} htmlFor="qp-code">Subject code</label><input id="qp-code" className={input} value={details.subject_code} onChange={(e) => set({ subject_code: e.target.value })} /></div>
              <div>
                <label className={label} htmlFor="qp-exam">Examination</label>
                <select id="qp-exam" className={input} value={details.exam_name} onChange={(e) => set({ exam_name: e.target.value })}>{EXAMS.map((x) => <option key={x}>{x}</option>)}</select>
              </div>
              <div><label className={label} htmlFor="qp-year">Academic year</label><input id="qp-year" className={input} value={details.academic_year} onChange={(e) => set({ academic_year: e.target.value })} /></div>
              <div><label className={label} htmlFor="qp-sem">Semester</label><input id="qp-sem" className={input} inputMode="numeric" value={details.semester} onChange={(e) => set({ semester: e.target.value })} /></div>
              <div><label className={label} htmlFor="qp-date">Date</label><input id="qp-date" type="date" className={input} value={details.exam_date} onChange={(e) => set({ exam_date: e.target.value })} /></div>
              <div><label className={label} htmlFor="qp-duration">Duration</label><input id="qp-duration" className={input} value={details.duration} onChange={(e) => set({ duration: e.target.value })} /></div>
              <div><label className={label} htmlFor="qp-max">Maximum marks</label><input id="qp-max" type="number" min={1} className={input} value={details.total_marks} onChange={(e) => set({ total_marks: e.target.value })} /></div>
              <div><label className={label} htmlFor="qp-faculty">Faculty</label><input id="qp-faculty" className={input} value={details.faculty_name} onChange={(e) => set({ faculty_name: e.target.value })} /></div>
              <div><label className={label} htmlFor="qp-dept">Department</label><input id="qp-dept" className={input} value={details.department} onChange={(e) => set({ department: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={label} htmlFor="qp-college">Institution</label><input id="qp-college" className={input} value={details.college_name} onChange={(e) => set({ college_name: e.target.value })} /></div>
              <div className="sm:col-span-2"><label className={label} htmlFor="qp-note">Instructions to students</label><input id="qp-note" className={input} value={details.instructions} onChange={(e) => set({ instructions: e.target.value })} /></div>
            </div>
          </Card>

          <Card hover>
            <SectionTitle title="3. Marks pattern" subtitle="One row per question: Bloom's level, marks and course outcome" />
            <p className={`text-xs font-medium mb-3 ${configured === Number(details.total_marks) || parts.some((p) => p.questions.some((q) => q.or_after)) ? "text-muted" : "text-danger"}`}>
              Marks across all questions: {configured}. Maximum marks: {details.total_marks || "—"}.
              {parts.some((p) => p.questions.some((q) => q.or_after)) && " Questions joined by OR are alternatives, so the two totals differ."}
            </p>
            <div className="space-y-4">
              {parts.map((part, pi) => (
                <div key={pi} className="rounded-xl border border-gray-100 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input aria-label="Part name" className={`${input} font-semibold flex-1`} value={part.name} onChange={(e) => setParts((old) => old.map((p, i) => (i === pi ? { ...p, name: e.target.value } : p)))} />
                    <button onClick={() => setParts((old) => old.filter((_, i) => i !== pi))} aria-label={`Remove ${part.name}`} className="w-11 h-11 flex items-center justify-center text-muted hover:text-danger shrink-0"><Trash2 size={15} /></button>
                  </div>
                  <div className="space-y-2">
                    {part.questions.map((q, qi) => (
                      <div key={qi} className="grid grid-cols-[1fr_4.5rem_4.5rem_2.75rem] gap-2 items-center">
                        <select aria-label="Bloom's level" className={input} value={q.question_type} onChange={(e) => updateSlot(pi, qi, { question_type: e.target.value })}>{BLOOM_LEVELS.map((b) => <option key={b}>{b}</option>)}</select>
                        <input aria-label="Marks" type="number" min={1} className={input} value={q.marks} onChange={(e) => updateSlot(pi, qi, { marks: Number(e.target.value) })} />
                        <input aria-label="Course outcome" className={input} value={q.co} onChange={(e) => updateSlot(pi, qi, { co: e.target.value })} />
                        <button onClick={() => setParts((old) => old.map((p, i) => (i === pi ? { ...p, questions: p.questions.filter((_, j) => j !== qi) } : p)))} aria-label="Remove question" className="w-11 h-11 flex items-center justify-center text-muted hover:text-danger"><Trash2 size={14} /></button>
                        <label className="col-span-4 -mt-1 flex items-center gap-2 text-xs text-muted min-h-[28px]">
                          <input type="checkbox" className="w-4 h-4 accent-brand" checked={!!q.or_after} onChange={(e) => updateSlot(pi, qi, { or_after: e.target.checked })} /> Followed by “OR” (the next question is its alternative)
                        </label>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setParts((old) => old.map((p, i) => (i === pi ? { ...p, questions: [...p.questions, slot("Understand", 10, "CO1")] } : p)))} className="mt-2 inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-brand"><Plus size={15} /> Add question</button>
                </div>
              ))}
            </div>
            <button onClick={() => setParts((old) => [...old, { name: `PART ${String.fromCharCode(65 + old.length)}`, questions: [slot("Understand", 10, "CO1")] }])} className="mt-3 inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-brand"><Plus size={15} /> Add part</button>
          </Card>

          <Button className="w-full min-h-[48px]" onClick={generate} disabled={loading}>
            {loading ? <><Loader2 size={16} className="animate-spin" /> Generating two sets…</> : <><FileQuestion size={16} /> Generate Set A and Set B</>}
          </Button>
        </div>

        <div className="space-y-6 min-w-0">
          <Card hover className="!p-0 overflow-hidden">
            <div className="p-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-ink">Paper</h2>
                <p className="text-xs text-muted">Edit any question, or replace it with another from your sources</p>
              </div>
              {result && result.set_a && result.set_b && <PillNav items={[{ key: "A", label: "Set A" }, { key: "B", label: "Set B" }]} active={tab} onChange={(k) => { setTab(k as "A" | "B"); setEditing(null); }} />}
            </div>

            {!paper ? (
              <EmptyState icon={FileText} title="No paper yet" hint="Fill in the three steps and generate. Both sets appear here, ready to edit and download." />
            ) : (
              <>
                {validation && (
                  <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/70 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      <Badge tone="neutral">{liveMarks} marks on paper</Badge>
                      {Object.entries(validation.difficulty_mix || {}).map(([k, v]) => <Badge key={k} tone={k === "Easy" ? "success" : k === "Medium" ? "warning" : k === "Hard" ? "danger" : "neutral"}>{k}: {String(v)}</Badge>)}
                      {Object.entries(validation.co_marks || {}).map(([k, v]) => <Badge key={k} tone="info">{k}: {String(v)} marks</Badge>)}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(validation.bloom_distribution || {}).map(([level, count]) => (
                        <span key={level} className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${BLOOM_COLOR[level] || "#6B7280"}1A`, color: BLOOM_COLOR[level] || "#6B7280" }}>{level}: {String(count)}</span>
                      ))}
                    </div>
                    {validation.warnings?.length > 0 && <ul className="text-xs text-muted space-y-0.5 list-disc pl-4">{validation.warnings.map((w: string, i: number) => <li key={i}>{w}</li>)}</ul>}
                  </div>
                )}

                <div className="p-4 space-y-5">
                  {paper.map((part: any, pi: number) => (
                    <section key={pi}>
                      <h3 className="text-center text-xs font-bold tracking-widest text-ink mb-2">{part.name}</h3>
                      <ol className="space-y-2">
                        {part.questions.map((q: any, qi: number) => {
                          number += 1;
                          const id = `${tab}-${pi}-${qi}`;
                          const isEditing = editing === id;
                          return (
                            <li key={qi}>
                              <div className={`rounded-xl border p-3 ${q.question?.trim() ? "border-gray-100" : "border-danger/40 bg-danger/5"}`}>
                                <div className="flex gap-3">
                                  <span className="text-sm font-semibold text-ink shrink-0 w-6">{number}.</span>
                                  <div className="flex-1 min-w-0">
                                    {isEditing ? (
                                      <textarea autoFocus aria-label={`Question ${number}`} rows={3} value={q.question || ""} onChange={(e) => patchQuestion(pi, qi, { question: e.target.value, source: "edited", grounded: true })} className="w-full rounded-lg border border-brand/40 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
                                    ) : (
                                      <p className="text-sm text-ink break-words">{q.question?.trim() || <span className="text-danger">No question for this slot yet. Edit to type one, or replace.</span>}</p>
                                    )}
                                    <div className="flex items-center gap-2 flex-wrap mt-2">
                                      <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${BLOOM_COLOR[q.bloom_level] || "#6B7280"}1A`, color: BLOOM_COLOR[q.bloom_level] || "#6B7280" }}>{q.bloom_level || "Unclassified"} · {rbtLevel(q.bloom_level)}</span>
                                      <span className="text-[11px] text-muted">{q.co || "No CO"}</span>
                                      <span className={`text-[11px] ${q.source === "ai_generated" || q.source === "missing" ? "text-[#9c6b12] font-medium" : "text-muted"}`}>{SOURCE_LABEL[q.source] || ""}</span>
                                    </div>
                                  </div>
                                  <label className="shrink-0 text-right">
                                    <span className="sr-only">Marks for question {number}</span>
                                    <input type="number" min={1} value={q.marks} onChange={(e) => patchQuestion(pi, qi, { marks: Number(e.target.value) })} className="w-14 rounded-lg border border-gray-200 px-2 min-h-[36px] text-sm text-center outline-none focus:ring-2 focus:ring-brand/30" />
                                    <span className="block text-[10px] text-muted mt-0.5">marks</span>
                                  </label>
                                </div>
                                <div className="flex gap-2 mt-2 pl-9">
                                  <button onClick={() => setEditing(isEditing ? null : id)} className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-ink bg-gray-100 hover:bg-gray-200">
                                    {isEditing ? <><Check size={13} /> Done</> : <><Pencil size={13} /> Edit</>}
                                  </button>
                                  <button onClick={() => replace(pi, qi)} disabled={busy === id} className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-lg text-xs font-semibold text-brand bg-brand-light hover:bg-brand/20 disabled:opacity-60">
                                    {busy === id ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Replace
                                  </button>
                                </div>
                              </div>
                              {q.or_after && <p className="text-center text-xs font-bold text-muted my-2">OR</p>}
                            </li>
                          );
                        })}
                      </ol>
                    </section>
                  ))}
                </div>

                <div className="p-4 border-t border-gray-100 flex flex-wrap gap-2">
                  <Button className="flex-1 min-h-[44px]" onClick={save}><Save size={15} /> Save Set {tab}</Button>
                  <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={() => download("pdf")}><Download size={15} /> PDF</Button>
                  <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={() => download("docx")}><Download size={15} /> Word</Button>
                </div>
              </>
            )}
          </Card>

          <Card hover>
            <SectionTitle title="Your saved papers" subtitle={saved && saved.length ? `${saved.length} saved` : undefined} />
            {saved === null ? (
              <p className="text-sm text-muted text-center py-6">Loading…</p>
            ) : saved.length === 0 ? (
              <EmptyState icon={History} title="Nothing saved yet" hint="Papers you save appear here so you can reopen, edit and download them again." compact />
            ) : (
              <ul className="space-y-1.5">
                {saved.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 rounded-xl bg-gray-50 pl-3 pr-1 min-h-[56px]">
                    <button onClick={() => open(p.id)} className="flex-1 min-w-0 text-left py-2">
                      <span className="block text-sm font-medium text-ink truncate">{p.title} · Set {p.set_label}</span>
                      <span className="block text-xs text-muted truncate">{[p.created_at?.slice(0, 10), p.total_marks ? `${p.total_marks} marks` : null, p.questions ? `${p.questions} questions` : null].filter(Boolean).join(" · ")}</span>
                    </button>
                    <button onClick={() => setDeleteTarget(p)} aria-label={`Delete ${p.title} Set ${p.set_label}`} className="w-11 h-11 flex items-center justify-center text-muted hover:text-danger shrink-0"><Trash2 size={15} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <CenterModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete this paper?">
        <p className="text-sm text-muted mb-4">“{deleteTarget?.title} · Set {deleteTarget?.set_label}” will be removed from your saved papers. This can't be undone.</p>
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={() => setDeleteTarget(null)}>Keep it</Button>
          <Button variant="danger" className="flex-1 min-h-[44px]" onClick={confirmDelete}>Delete</Button>
        </div>
      </CenterModal>
    </>
  );
}
