"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { PillNav } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toaster";
import { motion, AnimatePresence } from "framer-motion";
import { FileText, Clock, Trash2, Upload, Inbox } from "lucide-react";
import { api, API_BASE } from "@/lib/api";

export default function TeacherNotesPage() {
  const [assignments, setAssignments] = useState<any[]>([]);
  const [assignmentId, setAssignmentId] = useState<number | "">("");
  const [kind, setKind] = useState<"note" | "deadline">("note");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [posting, setPosting] = useState(false);
  const [notes, setNotes] = useState<any[] | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const { push } = useToast();

  const load = () => {
    api.teacherAssignments().then((rows) => { setAssignments(rows); setLiveMode(true); if (rows.length && !assignmentId) setAssignmentId(rows[0].id); }).catch(() => setLiveMode(false));
    api.teacherNotes().then(setNotes).catch(() => setNotes([]));
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => { setTitle(""); setDescription(""); setDueDate(""); setFile(null); };

  const submit = async () => {
    if (!assignmentId) { push("Pick which batch/semester/subject this is for", "error"); return; }
    if (!title.trim()) { push("Title is required", "error"); return; }
    if (kind === "deadline" && !dueDate) { push("Due date is required for a deadline", "error"); return; }
    setPosting(true);
    try {
      const fd = new FormData();
      fd.append("teaching_assignment_id", String(assignmentId));
      fd.append("kind", kind);
      fd.append("title", title);
      fd.append("description", description);
      if (kind === "deadline") fd.append("due_date", dueDate);
      if (file) fd.append("file", file);
      await api.teacherCreateNote(fd);
      push(kind === "note" ? "Note posted to your students" : "Deadline posted to your students");
      resetForm();
      load();
    } catch (e: any) {
      push(e.message || "Failed to post", "error");
    }
    setPosting(false);
  };

  const remove = async (id: number) => {
    try {
      await api.teacherDeleteNote(id);
      push("Removed");
      load();
    } catch {
      push("Delete failed", "error");
    }
  };

  const assignment = assignments.find((a) => a.id === assignmentId);

  return (
    <>
      <Topbar greeting="Notes & Deadlines" subtitle="Dashboard > Notes & Deadlines" avatarLetter="T" />
      <div className="p-4 md:p-8 space-y-6">
        {assignments.length === 0 ? (
          <Card hover>
            <p className="text-sm text-muted text-center py-6">
              No teaching assignments configured yet. Add one on your Dashboard's "My Teaching Assignments" card before posting notes or deadlines.
            </p>
          </Card>
        ) : (
          <Card hover>
            <SectionTitle title="Post a Note or Deadline" subtitle="Visible only to students in the batch/semester/section you select" />
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">For which class</label>
                <select value={assignmentId} onChange={(e) => setAssignmentId(Number(e.target.value))} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none">
                  {assignments.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.batch} · Sem {a.semester}{a.section ? ` · Sec ${a.section}` : " · All sections"} · {a.subject_code} — {a.subject_name}
                    </option>
                  ))}
                </select>
              </div>

              <PillNav items={[{ key: "note", label: "Study Note" }, { key: "deadline", label: "Assignment / Deadline" }]} active={kind} onChange={(k) => setKind(k as "note" | "deadline")} />

              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Title <span className="text-danger">*</span></label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "note" ? "e.g. Module 3 — Normalization Notes" : "e.g. Assignment 2 Submission"} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>

              {kind === "deadline" && (
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Due Date <span className="text-danger">*</span></label>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Description</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>

              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Attach File (optional)</label>
                <input type="file" accept=".pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-xs" />
                {file && <p className="text-xs text-success mt-1">Selected: {file.name}</p>}
              </div>

              <Button onClick={submit} disabled={posting}>
                <Upload size={14} /> {posting ? "Posting..." : kind === "note" ? "Post Note" : "Post Deadline"}
              </Button>
            </div>
          </Card>
        )}

        <Card hover>
          <SectionTitle title="Posted by You" subtitle={notes && notes.length > 0 ? `${notes.length} item(s)` : undefined} />
          {notes === null ? (
            <p className="text-sm text-muted text-center py-6">Loading...</p>
          ) : notes.length === 0 ? (
            <div className="text-center py-8">
              <Inbox size={24} className="text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted">Nothing posted yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {notes.map((n) => (
                  <motion.div key={n.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100">
                    <div className="w-9 h-9 rounded-lg bg-brand-light flex items-center justify-center shrink-0">
                      {n.kind === "deadline" ? <Clock size={16} className="text-brand" /> : <FileText size={16} className="text-brand" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{n.title}</div>
                      <div className="text-xs text-muted truncate">
                        {n.batch} · Sem {n.semester}{n.section ? ` · Sec ${n.section}` : ""} · {n.subject_code}
                        {n.due_date ? ` · Due ${n.due_date}` : ""}
                      </div>
                    </div>
                    <Badge tone={n.kind === "deadline" ? "warning" : "brand"}>{n.kind === "deadline" ? "Deadline" : "Note"}</Badge>
                    {n.file_url && <a href={`${API_BASE}${n.file_url}`} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline shrink-0">File</a>}
                    <button onClick={() => remove(n.id)} className="text-muted hover:text-danger p-1.5 shrink-0"><Trash2 size={14} /></button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
