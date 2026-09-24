"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { PillNav } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toaster";
import { motion, AnimatePresence } from "framer-motion";
import { Send, MessageCircle, Pencil, Trash2, Inbox, Users, Reply, CheckSquare, Square } from "lucide-react";
import { api } from "@/lib/api";

const REPLY_TONE: Record<string, "success" | "warning" | "info" | "brand"> = {
  Completed: "success", Done: "success", Pending: "warning", Following: "info",
};

function NoteCard({
  n, onEdit, onDelete, onReply, replyDraft, onReplyDraftChange, replyOpen, onToggleReply, studentLabel,
}: {
  n: any;
  onEdit: () => void;
  onDelete: () => void;
  onReply: () => void;
  replyDraft: string;
  onReplyDraftChange: (v: string) => void;
  replyOpen: boolean;
  onToggleReply: () => void;
  studentLabel?: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="p-4 rounded-xl bg-gray-50">
      <div className="flex items-start gap-3">
        <MessageCircle size={16} className="text-brand mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          {studentLabel && <div className="text-xs font-semibold text-ink mb-0.5">{studentLabel}</div>}
          <div className="text-xs text-muted mb-1">{n.date}{n.updated_at ? " · edited" : ""}</div>
          <div className="text-sm text-ink leading-relaxed">{n.note}</div>

          {n.reply_status && (
            <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <Badge tone={REPLY_TONE[n.reply_status] || "brand"}>{n.reply_status}</Badge>
                <span className="text-[10px] text-muted">replied {n.replied_at?.slice(0, 10)}</span>
              </div>
              {n.reply_description && <p className="text-xs text-ink">{n.reply_description}</p>}
            </div>
          )}

          {n.teacher_reply && (
            <div className="mt-2 pt-2 border-t border-dashed border-gray-200">
              <div className="text-[10px] text-muted mb-0.5">Your reply · {n.teacher_replied_at?.slice(0, 10)}</div>
              <p className="text-xs text-ink italic">{n.teacher_reply}</p>
            </div>
          )}

          {replyOpen && (
            <div className="mt-2.5 flex gap-2">
              <input
                value={replyDraft}
                onChange={(e) => onReplyDraftChange(e.target.value)}
                placeholder="Reply to this student..."
                className="flex-1 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none"
              />
              <Button size="sm" onClick={onReply}>Send</Button>
            </div>
          )}
        </div>
        <div className="flex gap-1 shrink-0">
          {n.reply_status && (
            <button onClick={onToggleReply} className={`p-1.5 rounded-lg hover:bg-white ${replyOpen ? "text-brand" : "text-muted hover:text-brand"}`} title="Reply to student">
              <Reply size={13} />
            </button>
          )}
          <button onClick={onEdit} className="text-muted hover:text-brand p-1.5 rounded-lg hover:bg-white"><Pencil size={13} /></button>
          <button onClick={onDelete} className="text-muted hover:text-danger p-1.5 rounded-lg hover:bg-white"><Trash2 size={13} /></button>
        </div>
      </div>
    </motion.div>
  );
}

export default function TeacherCounselingPage() {
  const [tab, setTab] = useState("compose");
  const [batches, setBatches] = useState<string[]>([]);
  const [batch, setBatch] = useState("");
  const [semesters, setSemesters] = useState<number[]>([]);
  const [semester, setSemester] = useState<number | null>(null);
  const [section, setSection] = useState("");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [students, setStudents] = useState<any[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<any>(null);
  const [studentNotes, setStudentNotes] = useState<any[]>([]);
  const [historyNotes, setHistoryNotes] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [editText, setEditText] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [replyOpenId, setReplyOpenId] = useState<number | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const { push } = useToast();

  useEffect(() => {
    api.teacherMyBatches().then((b) => { setBatches(b); if (b.length) setBatch(b[0]); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (batch) api.teacherAvailableSemesters(batch).then((s) => { setSemesters(s); if (s.length) setSemester(s[0]); else setSemester(null); }).catch(() => {});
  }, [batch]);

  useEffect(() => {
    if (batch && semester != null) {
      api.teacherStudents({ batch, semester: String(semester) }).then((rows) => {
        const filtered = section ? rows.filter((r: any) => r.section === section) : rows;
        setStudents(filtered);
        setSelectedIds(new Set(filtered.map((r: any) => r.id)));
        setSelected(null);
        setStudentNotes([]);
      }).catch(() => setStudents([]));
    }
  }, [batch, semester, section]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab]);

  const loadHistory = () => {
    api.teacherCounselingHistory().then(setHistoryNotes).catch(() => setHistoryNotes([]));
  };

  const loadNotesFor = (student: any) => {
    setSelected(student);
    api.teacherCounseling(student.id).then(setStudentNotes).catch(() => setStudentNotes([]));
  };

  const toggleStudent = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(students.map((s: any) => s.id)));
  const clearAll = () => setSelectedIds(new Set());

  const sendToGroup = async () => {
    if (!batch || semester == null) { push("Select a batch and semester", "error"); return; }
    if (!note.trim()) { push("Write a note first", "error"); return; }
    if (selectedIds.size === 0) { push("Select at least one student", "error"); return; }
    setSending(true);
    try {
      const res = await api.teacherAddCounselingBulk({
        batch, semester, section: section || undefined, note,
        student_ids: Array.from(selectedIds),
      });
      push(res.message);
      setNote("");
      if (selected) loadNotesFor(selected);
    } catch (e: any) {
      push(e.message || "Failed to send", "error");
    }
    setSending(false);
  };

  const saveEdit = async () => {
    if (!editing) return;
    try {
      await api.teacherEditCounseling(editing.id, editText);
      push("Note updated");
      setEditing(null);
      if (selected) loadNotesFor(selected);
      if (tab === "history") loadHistory();
    } catch {
      push("Update failed", "error");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await api.teacherDeleteCounseling(deleteTarget.id);
      push("Note deleted");
      setDeleteTarget(null);
      if (selected) loadNotesFor(selected);
      if (tab === "history") loadHistory();
    } catch {
      push("Delete failed", "error");
    }
  };

  const sendReply = async (noteId: number) => {
    const reply = (replyDrafts[noteId] || "").trim();
    if (!reply) { push("Write a reply first", "error"); return; }
    try {
      await api.teacherReplyCounseling(noteId, reply);
      push("Reply sent to the student");
      setReplyOpenId(null);
      setReplyDrafts((d) => ({ ...d, [noteId]: "" }));
      if (selected) loadNotesFor(selected);
      if (tab === "history") loadHistory();
    } catch {
      push("Reply failed", "error");
    }
  };

  return (
    <>
      <Topbar greeting="Student Counseling" subtitle="Dashboard > Student Counseling" avatarLetter="T" />
      <div className="p-8 space-y-6">
        <PillNav items={[{ key: "compose", label: "Send a Note" }, { key: "history", label: "All Sent Notes" }]} active={tab} onChange={setTab} />

        {tab === "compose" && (
          <>
            <Card hover>
              <SectionTitle title="Send a Note to a Group" subtitle="Filter to a batch/semester (and optionally section), then pick one or more students to send the same note to" />
              <div className="grid md:grid-cols-4 gap-3 mb-4">
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Batch</label>
                  <select value={batch} onChange={(e) => setBatch(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                    {batches.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Semester (only yours)</label>
                  <select value={semester ?? ""} onChange={(e) => setSemester(Number(e.target.value))} className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                    {semesters.length === 0 && <option value="">No assignments</option>}
                    {semesters.map((s) => <option key={s} value={s}>Sem {s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Section (optional)</label>
                  <input value={section} onChange={(e) => setSection(e.target.value)} placeholder="All sections" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
                </div>
                <div className="flex items-end">
                  <div className="text-xs text-muted flex items-center gap-1.5"><Users size={13} /> {selectedIds.size} of {students.length} selected</div>
                </div>
              </div>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Write the counseling note for this group..." className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30 mb-3" />
              <Button onClick={sendToGroup} disabled={sending}><Send size={14} /> {sending ? "Sending..." : `Send to ${selectedIds.size} Student(s)`}</Button>
            </Card>

            <div className="grid lg:grid-cols-3 gap-6">
              <Card hover>
                <div className="flex items-center justify-between mb-2">
                  <SectionTitle title="Students in This Group" />
                  {students.length > 0 && (
                    <div className="flex gap-2 text-xs">
                      <button onClick={selectAll} className="text-brand hover:underline">Select all</button>
                      <button onClick={clearAll} className="text-muted hover:underline">Clear</button>
                    </div>
                  )}
                </div>
                {students.length === 0 ? (
                  <p className="text-sm text-muted text-center py-6">No students match this batch/semester/section.</p>
                ) : (
                  <div className="space-y-1 max-h-96 overflow-y-auto">
                    {students.map((s: any) => (
                      <div key={s.id} className={`w-full flex items-center gap-2.5 p-2.5 rounded-xl transition-colors ${selected?.id === s.id ? "bg-brand-light" : "hover:bg-gray-50"}`}>
                        <button onClick={() => toggleStudent(s.id)} className="text-brand shrink-0">
                          {selectedIds.has(s.id) ? <CheckSquare size={16} /> : <Square size={16} className="text-gray-300" />}
                        </button>
                        <button onClick={() => loadNotesFor(s)} className="flex-1 text-left min-w-0">
                          <div className="text-sm font-medium text-ink truncate">{s.name}</div>
                          <div className="text-xs text-muted">{s.usn}</div>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card className="lg:col-span-2" hover>
                <SectionTitle title={selected ? `Notes — ${selected.name}` : "Select a student"} subtitle="Your own notes for this student, with their reply if any" />
                {!selected ? (
                  <p className="text-sm text-muted text-center py-8">Click a student's name to view their notes.</p>
                ) : studentNotes.length === 0 ? (
                  <div className="text-center py-8">
                    <Inbox size={24} className="text-muted mx-auto mb-2 opacity-50" />
                    <p className="text-sm text-muted">No notes from you for this student yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <AnimatePresence>
                      {studentNotes.map((n: any) => (
                        <NoteCard
                          key={n.id}
                          n={n}
                          onEdit={() => { setEditing(n); setEditText(n.note); }}
                          onDelete={() => setDeleteTarget(n)}
                          onReply={() => sendReply(n.id)}
                          replyDraft={replyDrafts[n.id] || ""}
                          onReplyDraftChange={(v) => setReplyDrafts((d) => ({ ...d, [n.id]: v }))}
                          replyOpen={replyOpenId === n.id}
                          onToggleReply={() => setReplyOpenId(replyOpenId === n.id ? null : n.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </Card>
            </div>
          </>
        )}

        {tab === "history" && (
          <Card hover>
            <SectionTitle title="All Sent Notes" subtitle="Every counseling note you've sent, across all students — newest first" />
            {historyNotes.length === 0 ? (
              <div className="text-center py-10">
                <Inbox size={24} className="text-muted mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted">You haven't sent any counseling notes yet.</p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                <AnimatePresence>
                  {historyNotes.map((n: any) => (
                    <NoteCard
                      key={n.id}
                      n={n}
                      studentLabel={`${n.student_name} — ${n.student_usn}`}
                      onEdit={() => { setEditing(n); setEditText(n.note); }}
                      onDelete={() => setDeleteTarget(n)}
                      onReply={() => sendReply(n.id)}
                      replyDraft={replyDrafts[n.id] || ""}
                      onReplyDraftChange={(v) => setReplyDrafts((d) => ({ ...d, [n.id]: v }))}
                      replyOpen={replyOpenId === n.id}
                      onToggleReply={() => setReplyOpenId(replyOpenId === n.id ? null : n.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </Card>
        )}
      </div>

      <CenterModal open={!!editing} onClose={() => setEditing(null)} title="Edit Note">
        <div className="space-y-4">
          <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={4} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>Cancel</Button>
            <Button className="flex-1" onClick={saveEdit}>Save</Button>
          </div>
        </div>
      </CenterModal>

      <CenterModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Note">
        <div className="space-y-4">
          <p className="text-sm text-ink">Delete this counseling note? The student will no longer see it.</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={confirmDelete}>Delete</Button>
          </div>
        </div>
      </CenterModal>
    </>
  );
}
