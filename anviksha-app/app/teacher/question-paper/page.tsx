"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Button } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { Download, FileQuestion, Plus, Save, Trash2, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { downloadGeneratedQuestionPaperDOCX, downloadGeneratedQuestionPaperPDF } from "@/lib/fileGen";

type Question = { question_type: string; marks: number; co: string; or_after?: boolean };
type Part = { name: string; questions: Question[] };
const field = "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-brand";
const newQuestion = (): Question => ({ question_type: "Understand", marks: 5, co: "CO1", or_after: false });
const newPart = (index: number): Part => ({ name: `PART ${String.fromCharCode(65 + index)}`, questions: Array.from({ length: 4 }, newQuestion) });

export default function QuestionPaperPage() {
  const { push } = useToast();
  const [subject, setSubject] = useState("");
  const [facultyName, setFacultyName] = useState("");
  const [examDate, setExamDate] = useState("");
  const [examTime, setExamTime] = useState("");
  const [totalMarks, setTotalMarks] = useState("");
  const [headerStyle, setHeaderStyle] = useState("Standard");
  const [headerImage, setHeaderImage] = useState<string>();
  const [notes, setNotes] = useState<any[]>([]);
  const [important, setImportant] = useState<any[]>([]);
  const [sourceModule, setSourceModule] = useState("");
  const [parts, setParts] = useState<Part[]>([newPart(0), newPart(1), newPart(2)]);
  const [result, setResult] = useState<any>();
  const [tab, setTab] = useState<"A" | "B">("A");
  const [saved, setSaved] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const configuredMarks = parts.reduce((sum, part) => sum + part.questions.reduce((marks, question) => marks + question.marks, 0), 0);

  useEffect(() => { api.listQuestionPapers().then(setSaved).catch(() => undefined); }, []);

  const upload = async (kind: "notes" | "important_questions", event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []); event.target.value = "";
    for (const file of files) {
      try { const response = await api.uploadQuestionPaperDocument(kind, file, sourceModule || undefined); (kind === "notes" ? setNotes : setImportant)(old => [...old, response]); }
      catch (error: any) { push(error.message || "Upload failed", "error"); }
    }
  };
  const uploadHeader = (event: ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0]; if (!image) return;
    if (!/^image\/(png|jpeg)$/.test(image.type)) { push("Custom headers must be PNG or JPG images.", "error"); return; }
    const reader = new FileReader(); reader.onload = () => setHeaderImage(String(reader.result)); reader.readAsDataURL(image);
  };
  const updateQuestion = (partIndex: number, questionIndex: number, update: Partial<Question>) => setParts(old => old.map((part, index) => index === partIndex ? { ...part, questions: part.questions.map((question, qIndex) => qIndex === questionIndex ? { ...question, ...update } : question) } : part));
  const generate = async () => {
    if (!notes.length || !important.length) return push("Upload both Subject Notes and Important Questions before generation.", "error");
    if (!parts.length || parts.some(part => !part.questions.length || part.questions.some(question => question.marks <= 0 || !question.co || !question.question_type))) return push("Every part needs valid questions with type, marks, and CO/Module.", "error");
    if (!totalMarks || Number(totalMarks) <= 0) return push("Enter the total marks manually before generation.", "error");
    if (headerStyle === "Custom Header" && !headerImage) return push("Upload a custom header image or select a predefined style.", "error");
    setLoading(true);
    try {
      const settings = { subject_name: subject, faculty_name: facultyName, exam_date: examDate, exam_time: examTime, total_marks: Number(totalMarks), header_style: headerStyle, custom_header_image: headerImage, structure: parts };
      const data = await api.generateQuestionPaper({ settings, note_ids: notes.map(item => item.id), important_question_ids: important.map(item => item.id) });
      setResult({ ...data, settings }); push("Generated distinct, note-grounded Set A and Set B papers.");
    } catch (error: any) { push(error.message || "Generation failed", "error"); }
    finally { setLoading(false); }
  };
  const save = async (label: "A" | "B") => {
    if (!result) return;
    try { await api.saveQuestionPaper({ title: subject || "Question Paper", set_label: label, settings: result.settings, paper: label === "A" ? result.set_a : result.set_b, validation: result.validation }); setSaved(await api.listQuestionPapers()); push(`Set ${label} saved.`); }
    catch (error: any) { push(error.message || "Save failed", "error"); }
  };
  const open = async (id: number) => { try { const paper = await api.getQuestionPaper(id); setResult({ ...paper, settings: paper.settings }); setTab(paper.set_label); setSubject(paper.settings.subject_name || ""); setFacultyName(paper.settings.faculty_name || ""); setExamDate(paper.settings.exam_date || ""); setExamTime(paper.settings.exam_time || ""); setTotalMarks(String(paper.settings.total_marks || "")); setHeaderStyle(paper.settings.header_style || "Standard"); setHeaderImage(paper.settings.custom_header_image); } catch (error: any) { push(error.message || "Could not open the saved paper", "error"); } };
  const remove = async (id: number) => { if (!confirm("Permanently delete this saved paper?")) return; try { await api.deleteQuestionPaper(id); setSaved(old => old.filter(item => item.id !== id)); } catch (error: any) { push(error.message || "Delete failed", "error"); } };
  const paper = tab === "A" ? result?.set_a : result?.set_b;
  const download = async (format: "pdf" | "docx") => {
    if (!paper) return;
    const details = { subject_name: subject, date: examDate, time: examTime, total_marks: totalMarks, custom_header_image: headerImage };
    try {
      if (format === "pdf") downloadGeneratedQuestionPaperPDF(details, paper, tab);
      else await downloadGeneratedQuestionPaperDOCX(details, paper, tab);
    } catch (error: any) { push(error.message || "Download failed", "error"); }
  };

  return (
    <><Topbar greeting="Question Paper Generator" subtitle="Teacher workspace > Question papers" avatarLetter="R" />
      <div className="p-6 grid xl:grid-cols-2 gap-6"><div className="space-y-5">
        <Card><h2 className="font-semibold">1. Documents</h2><p className="text-xs text-muted mt-1">Both files are required. Every question is selected from the Important Questions file and supported by Subject Notes. Tag single-module files so the selected paper module is enforced.</p><select className={`${field} mt-3`} value={sourceModule} onChange={event => setSourceModule(event.target.value)}><option value="">Auto-detect modules from document</option>{[1, 2, 3, 4, 5].map(module => <option key={module} value={`Module ${module}`}>Module {module}</option>)}</select><div className="grid md:grid-cols-2 gap-3 mt-3"><Uploader title="Upload Subject Notes" items={notes} onChange={event => upload("notes", event)} remove={id => setNotes(old => old.filter(item => item.id !== id))} /><Uploader title="Upload Important Questions" items={important} onChange={event => upload("important_questions", event)} remove={id => setImportant(old => old.filter(item => item.id !== id))} /></div></Card>
        <Card><h2 className="font-semibold">2. Paper Details</h2><div className="grid md:grid-cols-2 gap-3 mt-3"><input className={field} placeholder="Subject Name" value={subject} onChange={event => setSubject(event.target.value)} /><input className={field} placeholder="Faculty Name" value={facultyName} onChange={event => setFacultyName(event.target.value)} /><input className={field} type="date" value={examDate} onChange={event => setExamDate(event.target.value)} /><input className={field} type="time" value={examTime} onChange={event => setExamTime(event.target.value)} /><input className={field} type="number" min="1" placeholder="Total Marks (manual)" value={totalMarks} onChange={event => setTotalMarks(event.target.value)} /></div><select className={`${field} mt-3`} value={headerStyle} onChange={event => setHeaderStyle(event.target.value)}>{["Standard", "University Style", "College Style", "Department Style", "Minimal", "Custom Header"].map(option => <option key={option}>{option}</option>)}</select>{headerStyle === "Custom Header" && <div className="mt-3 border border-dashed border-brand/30 rounded-xl p-3"><label className="cursor-pointer flex gap-2 text-sm"><Upload size={15} />Upload Header Image<input className="hidden" type="file" accept=".png,.jpg,.jpeg" onChange={uploadHeader} /></label>{headerImage && <><img src={headerImage} alt="Custom header preview" className="mt-3 max-h-28 w-full object-contain" /><button className="mt-2 text-xs text-red-500" onClick={() => setHeaderImage(undefined)}>Remove image</button></>}</div>}</Card>
        <Card><div className="flex justify-between"><h2 className="font-semibold">3. Paper Structure</h2><span className="text-xs text-muted">Question marks: {configuredMarks} · Paper total: {totalMarks || "—"}</span></div>{parts.map((part, partIndex) => <PartEditor key={partIndex} part={part} index={partIndex} updateQuestion={updateQuestion} addQuestion={() => setParts(old => old.map((item, index) => index === partIndex ? { ...item, questions: [...item.questions, newQuestion()] } : item))} removeQuestion={questionIndex => setParts(old => old.map((item, index) => index === partIndex ? { ...item, questions: item.questions.filter((_, qIndex) => qIndex !== questionIndex) } : item))} removePart={() => { if (confirm(`Remove ${part.name}?`)) setParts(old => old.filter((_, index) => index !== partIndex)); }} />)}<button className="mt-3 text-sm text-brand flex gap-1" onClick={() => setParts(old => [...old, newPart(old.length)])}><Plus size={14} />Add Part</button></Card>
        <Button className="w-full" onClick={generate} disabled={loading}>{loading ? "Generating grounded sets..." : <><FileQuestion size={16} />Generate Set A & Set B</>}</Button>
        <Card><h2 className="font-semibold">Saved Question Papers</h2>{saved.map(item => <div className="mt-2 flex gap-2 text-sm border rounded-lg p-2" key={item.id}><b>Set {item.set_label}</b><span className="flex-1">{item.title}</span><button className="text-brand" onClick={() => open(item.id)}>View</button><button className="text-red-500" onClick={() => remove(item.id)}><Trash2 size={14} /></button></div>)}{!saved.length && <p className="mt-2 text-xs text-muted">No saved papers yet.</p>}</Card>
      </div><Card className="!p-0 h-fit overflow-hidden"><div className="p-4 bg-gray-50 border-b flex justify-between"><div><h2 className="font-semibold">Question Paper Preview</h2><p className="text-xs text-muted">Student-facing professional paper</p></div>{result && <div className="flex gap-3"><button className="text-xs text-brand flex gap-1" onClick={() => save(tab)}><Save size={14} />Save Set {tab}</button><button className="text-xs text-brand flex gap-1" onClick={() => download("pdf")}><Download size={14} />PDF</button><button className="text-xs text-brand flex gap-1" onClick={() => download("docx")}><Download size={14} />DOCX</button></div>}</div>{result && <div className="p-3 border-b flex gap-2"><button className={`px-3 py-1 text-xs rounded ${tab === "A" ? "bg-brand text-white" : "bg-gray-100"}`} onClick={() => setTab("A")}>Set A</button><button className={`px-3 py-1 text-xs rounded ${tab === "B" ? "bg-brand text-white" : "bg-gray-100"}`} onClick={() => setTab("B")}>Set B</button></div>}{result && <ValidationSummary validation={tab === "A" ? result.validation?.set_a : result.validation?.set_b} />}<div className="p-7 min-h-[600px] bg-[#fcfcfb]">{paper ? <Preview paper={paper} set={tab} subject={subject} facultyName={facultyName} examDate={examDate} examTime={examTime} marks={totalMarks} header={headerImage} /> : <div className="h-[500px] flex flex-col justify-center items-center text-muted"><FileQuestion size={32} className="opacity-30" />Configure the paper and generate both sets.</div>}</div></Card></div>
    </>
  );
}

function Uploader({ title, items, onChange, remove }: { title: string; items: any[]; onChange: (event: ChangeEvent<HTMLInputElement>) => void; remove: (id: number) => void }) { return <div className="border border-dashed border-brand/30 rounded-xl p-3"><label className="cursor-pointer flex gap-2 text-sm font-medium"><Upload size={15} />{title}<input className="hidden" type="file" multiple accept=".pdf,.docx" onChange={onChange} /></label>{items.map(item => <div key={item.id} className="mt-2 flex gap-2 text-xs"><span className="truncate flex-1">{item.filename}</span><span className="text-success">{item.status}</span><button onClick={() => remove(item.id)}><Trash2 size={13} /></button></div>)}</div>; }
function PartEditor({ part, index, updateQuestion, addQuestion, removeQuestion, removePart }: any) { return <div className="mt-3 border rounded-xl p-3"><div className="flex justify-between"><b>{part.name}</b><button className="text-xs text-red-500" onClick={removePart}>Remove Part</button></div>{part.questions.map((question: Question, questionIndex: number) => <div key={questionIndex}><div className="grid grid-cols-[1fr_70px_90px_20px] gap-2 mt-2 items-end"><select className={field} value={question.question_type} onChange={event => updateQuestion(index, questionIndex, { question_type: event.target.value })}>{["Remember", "Understand", "Apply", "Analyze", "Evaluate", "Create", "Any"].map(type => <option key={type}>{type}</option>)}</select><input className={field} type="number" min="1" value={question.marks} onChange={event => updateQuestion(index, questionIndex, { marks: Number(event.target.value) })} /><select className={field} value={question.co} onChange={event => updateQuestion(index, questionIndex, { co: event.target.value })}>{["CO1", "CO2", "CO3", "CO4", "CO5", "Module 1", "Module 2", "Module 3", "Module 4", "Module 5"].map(value => <option key={value}>{value}</option>)}</select><button className="text-red-500 pb-2" onClick={() => removeQuestion(questionIndex)}><Trash2 size={14} /></button></div>{questionIndex < part.questions.length - 1 && <label className="mt-2 inline-flex items-center gap-1 text-xs text-muted"><input type="checkbox" checked={Boolean(question.or_after)} onChange={event => updateQuestion(index, questionIndex, { or_after: event.target.checked })} />Place OR after this question</label>}</div>)}<div className="mt-3 text-xs"><button className="text-brand flex gap-1" onClick={addQuestion}><Plus size={13} />Add Question</button></div></div>; }
function ValidationSummary({ validation }: { validation: any }) {
  if (!validation) return null;
  const distribution: Record<string, number> = validation.bloom_distribution || {};
  return (
    <div className="px-4 py-2.5 border-b bg-gray-50/60 text-xs space-y-1.5">
      <div className="flex flex-wrap gap-2">
        {Object.entries(distribution).map(([level, count]) => (
          <span key={level} className="px-2 py-0.5 rounded-full font-semibold" style={{ background: `${BLOOM_COLOR[level] || "#6B7280"}1A`, color: BLOOM_COLOR[level] || "#6B7280" }}>
            {level}: {count}
          </span>
        ))}
        <span className={`px-2 py-0.5 rounded-full font-semibold ${validation.marks_match ? "bg-success/10 text-success" : "bg-danger/10 text-danger"}`}>
          {validation.total_marks_generated}/{validation.total_marks_configured} marks
        </span>
        {validation.duplicate_count > 0 && <span className="px-2 py-0.5 rounded-full font-semibold bg-danger/10 text-danger">{validation.duplicate_count} duplicate(s)</span>}
      </div>
      {validation.warnings?.length > 0 && (
        <ul className="text-muted space-y-0.5">
          {validation.warnings.map((w: string, i: number) => <li key={i}>⚠ {w}</li>)}
        </ul>
      )}
    </div>
  );
}
const BLOOM_COLOR: Record<string, string> = { Remember: "#6B7280", Understand: "#3B82F6", Apply: "#1F9D55", Analyze: "#E8A93B", Evaluate: "#F97316", Create: "#5B3FD9" };
const SOURCE_LABEL: Record<string, string> = { extracted: "from your upload", paraphrased: "reworded by AI", ai_generated: "AI-completed", missing: "unfilled" };
function QuestionBadge({ question }: { question: any }) {
  const color = BLOOM_COLOR[question.bloom_level] || "#6B7280";
  return (
    <span className="inline-flex items-center gap-1 mt-1">
      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: `${color}1A`, color }}>{question.bloom_level || "Unclassified"}</span>
      <span className="text-[10px] text-muted">· {SOURCE_LABEL[question.source] || question.tag_source || question.source}</span>
    </span>
  );
}
function Preview({ paper, set, subject, facultyName, examDate, examTime, marks, header }: any) { return <div className="font-serif text-[12px] leading-5">{header && <img src={header} alt="Custom header" className="max-h-28 w-full object-contain mb-3" />}<div className="text-center border-b-2 border-black pb-3"><b>QUESTION PAPER — SET {set}</b><br />{subject}<br />{facultyName && <>FACULTY: {facultyName}<br /></>}{examDate && <>DATE: {examDate}</>}{examTime && <> &nbsp; TIME: {examTime}</>}<br />MAX MARKS: {marks}</div>{paper.map((part: any) => <div key={part.name} className="mt-4"><div className="text-center font-bold border-y">{part.name}</div>{part.questions.map((question: any, index: number) => <div key={index}><div className="mt-3 flex gap-2"><b>{index + 1}.</b><span className="flex-1">{question.question}<br /><small>({question.co})</small><br /><QuestionBadge question={question} /></span><b>[{question.marks}M]</b></div>{question.or_after && <div className="text-center font-bold mt-2">OR</div>}</div>)}</div>)}</div>; }
