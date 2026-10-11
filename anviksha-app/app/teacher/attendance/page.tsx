"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { PillNav } from "@/components/ui/Tabs";
import { SimpleBarChart } from "@/components/charts/Charts";
import { useToast } from "@/components/ui/Toaster";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, CheckCheck, History, Trash2, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

export default function AttendanceUploadPage() {
  const [tab, setTab] = useState("mark");
  const [batches, setBatches] = useState<string[]>([]);
  const [batch, setBatch] = useState<string>("");
  const [semesters, setSemesters] = useState<number[]>([]);
  const [semester, setSemester] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [assignedSubjects, setAssignedSubjects] = useState<any[]>([]);
  const [subject, setSubject] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState<Record<string, boolean>>({});
  const [submitted, setSubmitted] = useState(false);
  const [absentNames, setAbsentNames] = useState<string[]>([]);
  const [liveMode, setLiveMode] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [editingSession, setEditingSession] = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [presentPct, setPresentPct] = useState<number | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const { push } = useToast();

  const loadAnalytics = async (forDate: string) => {
    if (!subject) return;
    try {
      const res = await api.teacherAttendanceAnalytics(subject.id, forDate);
      setAnalytics(res);
    } catch {
      setAnalytics(null);
    }
  };

  useEffect(() => {
    api.teacherMyBatches().then((b) => { setBatches(b); if (b.length) setBatch(b[0]); setLiveMode(true); }).catch(() => setLiveMode(false));
    api.teacherSubjects().then(setSubjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (batch) api.teacherAvailableSemesters(batch).then((s) => { setSemesters(s); if (s.length) setSemester(s[0]); }).catch(() => {});
  }, [batch]);

  useEffect(() => {
    if (batch && semester != null) {
      api.teacherAssignedSubjects(batch, semester).then((subs) => {
        setAssignedSubjects(subs);
        setSubject(subs[0] || null);
      }).catch(() => {});
    }
  }, [batch, semester]);

  useEffect(() => {
    // Scoped to this exact subject's own real assignment (batch+semester
    // +section) — not just batch+semester — so a subject taught only to one
    // section shows only that section's real roster.
    if (batch && semester != null && subject) {
      api.teacherStudents({ batch, semester: String(semester), subject_id: String(subject.id) }).then((rows) => {
        setStudents(rows);
        setRoster(Object.fromEntries(rows.map((s: any) => [s.id, true])));
      }).catch(() => {});
    }
  }, [subject]);

  useEffect(() => {
    if (subject) api.teacherAttendanceHistory(subject.id).then(setHistory).catch(() => {});
  }, [subject]);

  const presentCount = Object.values(roster).filter(Boolean).length;
  const markAll = (val: boolean) => setRoster(Object.fromEntries(students.map((s: any) => [s.id, val])));

  const submit = async () => {
    if (!subject) return;
    try {
      const res = await api.markAttendance({ subject_id: subject.id, date, records: roster });
      setSubmitted(true);
      setAbsentNames(res.absent_names || []);
      setPresentPct(res.present_pct ?? null);
      push(`Attendance saved — ${res.present}/${res.total} present (${res.present_pct ?? 0}%)`);
      api.teacherAttendanceHistory(subject.id).then(setHistory).catch(() => {});
      loadAnalytics(date);
    } catch {
      push("Backend save failed", "error");
    }
  };

  const confirmDeleteSession = async () => {
    if (!deleteTarget) return;
    try {
      await api.teacherDeleteAttendanceSession(deleteTarget.session_id);
      push("Attendance session deleted");
      setDeleteTarget(null);
      if (subject) api.teacherAttendanceHistory(subject.id).then(setHistory).catch(() => {});
    } catch {
      push("Delete failed", "error");
    }
  };

  const openEdit = async (session: any) => {
    const detail = await api.teacherAttendanceSession(session.session_id);
    setEditingSession({ ...session, records: detail.records });
    setRoster(detail.records);
    setTab("mark");
  };

  const updateAttendance = async () => {
    if (!editingSession) return;
    try {
      await api.teacherEditAttendance(editingSession.session_id, roster);
      push("Attendance updated");
      const editedDate = editingSession.date;
      setEditingSession(null);
      setAbsentNames(students.filter((s: any) => !roster[s.id]).map((s: any) => s.name));
      setPresentPct(students.length ? Math.round((presentCount / students.length) * 1000) / 10 : null);
      setSubmitted(true);
      if (subject) {
        api.teacherAttendanceHistory(subject.id).then(setHistory).catch(() => {});
        loadAnalytics(editedDate);
      }
    } catch {
      push("Update failed", "error");
    }
  };

  if (!subject) return (
    <>
      <Topbar greeting="Attendance Upload" subtitle="Dashboard > Attendance Upload" avatarLetter="T" />
      <div className="p-4 md:p-8 text-sm text-muted">
        {assignedSubjects.length === 0 && semesters.length === 0 ? "No teaching assignments found." : "Loading your real subjects..."}
      </div>
    </>
  );

  return (
    <>
      <Topbar greeting="Attendance Upload" subtitle="Dashboard > Attendance Upload" avatarLetter="T" />
      <div className="px-4 md:px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Real — only your own students, sessions actually saved" : "○ Backend not connected"}
        </span>
      </div>
      <div className="p-4 md:p-8 space-y-6">
        <PillNav items={[{ key: "mark", label: "Mark Attendance" }, { key: "history", label: "History" }]} active={tab} onChange={setTab} />

        {tab === "mark" && (
          <>
            <Card hover>
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Batch (entry year)</label>
                  <select value={batch} onChange={(e) => setBatch(e.target.value)} className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none w-36">
                    {batches.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Semester (only yours)</label>
                  <select value={semester ?? ""} onChange={(e) => setSemester(Number(e.target.value))} className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none w-40">
                    {semesters.map((s) => <option key={s} value={s}>Sem {s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Subject (only yours, for this batch+semester)</label>
                  {assignedSubjects.length > 1 ? (
                    <select value={subject?.id ?? ""} onChange={(e) => setSubject(assignedSubjects.find((s: any) => s.id === Number(e.target.value)))} className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none w-64">
                      {assignedSubjects.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                    </select>
                  ) : (
                    <div className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm bg-gray-50 w-64">{subject?.code} — {subject?.name}</div>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Session Date</label>
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
                </div>
                <Button variant="secondary" onClick={() => markAll(true)}><CheckCheck size={15} /> Mark All Present</Button>
                <div className="ml-auto text-sm">
                  <span className="text-success font-semibold">Present: {presentCount}</span>
                  <span className="text-muted"> / {students.length}</span>
                  <span className="text-danger font-semibold ml-3">Absent: {students.length - presentCount}</span>
                </div>
              </div>
            </Card>

            <Card hover>
              <SectionTitle title={`Roster — Sem ${semester} — ${subject.code}`} subtitle={date} />
              <div className="space-y-1 max-h-[420px] overflow-y-auto">
                {students.map((s: any, i: number) => (
                  <motion.div key={s.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.01, 0.3) }} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                    <div>
                      <div className="text-sm font-medium text-ink">{s.name}</div>
                      <div className="text-xs text-muted">{s.usn}</div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setRoster({ ...roster, [s.id]: true })} className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${roster[s.id] ? "bg-success text-white" : "bg-gray-100 text-muted hover:bg-success/20"}`}><Check size={16} /></button>
                      <button onClick={() => setRoster({ ...roster, [s.id]: false })} className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${!roster[s.id] ? "bg-danger text-white" : "bg-gray-100 text-muted hover:bg-danger/20"}`}><X size={16} /></button>
                    </div>
                  </motion.div>
                ))}
              </div>
              <div className="mt-5 flex justify-end gap-2">
                {editingSession ? (
                  <>
                    <Button variant="secondary" onClick={() => setEditingSession(null)}>Cancel</Button>
                    <Button onClick={updateAttendance}>Update Attendance</Button>
                  </>
                ) : (
                  <Button onClick={submit}>Submit Attendance</Button>
                )}
              </div>
              <AnimatePresence>
                {submitted && !editingSession && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 p-4 bg-success/10 rounded-xl">
                    <div className="text-sm font-semibold text-success mb-2">Attendance submitted successfully — {presentPct ?? 0}% present.</div>
                    {absentNames.length > 0 ? (
                      <>
                        <div className="text-xs text-muted mb-1">Absent Students:</div>
                        <div className="text-xs text-ink">{absentNames.map((n) => `• ${n}`).join("  ")}</div>
                      </>
                    ) : <div className="text-xs text-muted">Everyone was present.</div>}
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>

            {submitted && analytics && (
              <Card hover>
                <SectionTitle title="Attendance Analysis" subtitle={`As of ${analytics.date} — ${subject.code}`} />
                <div className="grid md:grid-cols-2 gap-6">
                  <div>
                    <div className="text-xs font-medium text-muted mb-2">This week's attendance pattern</div>
                    {analytics.weekly_pattern.length > 0 ? (
                      <SimpleBarChart
                        data={analytics.weekly_pattern.map((d: any) => ({ label: d.date.slice(5), value: d.present_pct ?? 0 }))}
                        xKey="label"
                        barKey="value"
                        color="#3B82F6"
                      />
                    ) : (
                      <p className="text-xs text-muted">No sessions recorded this week yet.</p>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-medium text-muted mb-2 flex items-center gap-1.5">
                      <AlertTriangle size={13} className="text-danger" /> Continuously absent (4+ sessions)
                    </div>
                    {analytics.continuously_absent.length === 0 ? (
                      <p className="text-xs text-muted">No students are on a 4+ session absence streak.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-48 overflow-y-auto">
                        {analytics.continuously_absent.map((s: any) => (
                          <div key={s.student_id} className="flex items-center justify-between p-2 rounded-lg bg-danger/5">
                            <div>
                              <div className="text-xs font-medium text-ink">{s.name}</div>
                              <div className="text-[10px] text-muted">{s.usn}</div>
                            </div>
                            <Badge tone="danger">{s.absent_streak} sessions</Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )}
          </>
        )}

        {tab === "history" && (
          <Card hover>
            <SectionTitle title="Attendance History" subtitle="Every session you've submitted for this subject" />
            {history.length === 0 ? (
              <p className="text-sm text-muted text-center py-8">No attendance sessions recorded yet.</p>
            ) : (
              <div className="space-y-2">
                {history.map((h: any) => (
                  <div key={h.session_id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100">
                    <div>
                      <div className="text-sm font-medium text-ink">{h.date} — {h.subject_code}</div>
                      <div className="text-xs text-muted">Sem {h.semester} · Total: {h.total} · Present: {h.present} · Absent: {h.absent} · <span className="font-semibold text-success">{h.present_pct ?? 0}% present</span></div>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(h)}>Edit</Button>
                      <button onClick={() => setDeleteTarget(h)} className="p-2 rounded-lg hover:bg-danger/10 text-danger"><Trash2 size={14} /></button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <CenterModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Attendance Session">
        <div className="space-y-4">
          <p className="text-sm text-ink">
            Delete the attendance session for <strong>{deleteTarget?.date}</strong> ({deleteTarget?.subject_code})? This removes it permanently — students will no longer see it.
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={confirmDeleteSession}>Delete</Button>
          </div>
        </div>
      </CenterModal>
    </>
  );
}
