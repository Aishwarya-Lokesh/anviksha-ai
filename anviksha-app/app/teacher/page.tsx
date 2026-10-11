"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { PillNav } from "@/components/ui/Tabs";
import { DonutChart } from "@/components/charts/Charts";
import { AskAIBar } from "@/components/ui/AskAI";
import { AIInsightCard } from "@/components/ui/AIInsightCard";
import { useToast } from "@/components/ui/Toaster";
import { motion, AnimatePresence } from "framer-motion";
import { Users, BookOpen, AlertTriangle, ClipboardList, Plus, Trash2, Info, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

export default function TeacherDashboard() {
  const { push } = useToast();
  const router = useRouter();
  const [teacherName, setTeacherName] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [liveMode, setLiveMode] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState({ batch: "", semester: 5, section: "", subject_id: "", subject_code: "", subject_name: "" });
  const [subjectStatus, setSubjectStatus] = useState<"idle" | "found" | "new">("idle");
  const [activeBatches, setActiveBatches] = useState<string[]>([]);
  const [passedOutBatches, setPassedOutBatches] = useState<string[]>([]);
  const [suggestedSemester, setSuggestedSemester] = useState<number | null>(null);
  const [semesterError, setSemesterError] = useState("");
  const [markPassedOut, setMarkPassedOut] = useState(false);
  const [showAtRisk, setShowAtRisk] = useState(false);
  const [atRiskStudents, setAtRiskStudents] = useState<any[]>([]);
  const [atRiskFilter, setAtRiskFilter] = useState("All");
  const [atRiskMessage, setAtRiskMessage] = useState("");
  const [atRiskSemester, setAtRiskSemester] = useState("");
  const [atRiskCgpaThreshold, setAtRiskCgpaThreshold] = useState("7");
  const [atRiskInternalThreshold, setAtRiskInternalThreshold] = useState("15");
  const [showMyStudents, setShowMyStudents] = useState(false);
  const [myStudentsData, setMyStudentsData] = useState<any>(null);
  const [showMySubjects, setShowMySubjects] = useState(false);
  const [mySubjectsData, setMySubjectsData] = useState<any>(null);
  const [extraWork, setExtraWork] = useState<{ extra_work: string | null; status: string | null } | null>(null);

  const fetchAtRisk = async (opts?: {
    filter?: string;
    semester?: string;
    cgpaThreshold?: string;
    internalThreshold?: string;
  }) => {
    const filter = opts?.filter ?? atRiskFilter;
    const semester = opts?.semester ?? atRiskSemester;
    const cgpaThreshold = opts?.cgpaThreshold ?? atRiskCgpaThreshold;
    const internalThreshold = opts?.internalThreshold ?? atRiskInternalThreshold;
    const res = await api.teacherAtRiskStudents({
      reason: filter === "All" ? undefined : filter,
      semester: semester || undefined,
      cgpaThreshold,
      internalThreshold,
    });
    setAtRiskStudents(res.students);
    setAtRiskMessage(res.message);
  };

  const openAtRisk = async () => {
    setShowAtRisk(true);
    setAtRiskFilter("All");
    setAtRiskSemester("");
    setAtRiskCgpaThreshold("7");
    setAtRiskInternalThreshold("15");
    await fetchAtRisk({ filter: "All", semester: "", cgpaThreshold: "7", internalThreshold: "15" });
  };

  const openMyStudents = async () => {
    setShowMyStudents(true);
    const res = await api.teacherDashboardStudents();
    setMyStudentsData(res);
  };

  const openMySubjects = async () => {
    setShowMySubjects(true);
    const res = await api.teacherDashboardSubjects();
    setMySubjectsData(res);
  };

  const loadAll = () => {
    api.teacherMe().then((d) => setTeacherName(d.name)).catch(() => setTeacherName("Teacher"));
    api.teacherDashboardStats().then((d) => { setStats(d); setLiveMode(true); }).catch(() => setLiveMode(false));
    api.teacherAssignments().then(setAssignments).catch(() => {});
    api.teacherSubjects().then(setSubjects).catch(() => {});
    api.teacherActiveBatches().then((b) => { setActiveBatches(b); if (b.length && !form.batch) updateBatch(b[0]); }).catch(() => {});
    api.teacherPassedOutBatches().then(setPassedOutBatches).catch(() => {});
    api.teacherExtraWork().then(setExtraWork).catch(() => {});
  };

  useEffect(() => { loadAll(); }, []);

  const completeExtraWork = async () => {
    try {
      await api.teacherUpdateExtraWorkStatus("completed");
      push("Marked as completed");
      api.teacherExtraWork().then(setExtraWork).catch(() => {});
    } catch {
      push("Could not update. Please try again.", "error");
    }
  };

  const deleteExtraWork = async () => {
    try {
      await api.teacherDeleteExtraWork();
      push("Extra work removed");
      setExtraWork({ extra_work: null, status: null });
    } catch {
      push("Could not remove. Please try again.", "error");
    }
  };

  const updateBatch = async (batch: string) => {
    setForm((f) => ({ ...f, batch }));
    setSemesterError("");
    setMarkPassedOut(false);
    if (!batch) return;
    if (passedOutBatches.includes(batch)) {
      // Passed-out batch: no current class to configure — batch alone is enough.
      setSuggestedSemester(null);
      setForm((f) => ({ ...f, batch, section: "", subject_id: "" }));
      return;
    }
    try {
      const res = await api.teacherNextSemesterForBatch(batch);
      setSuggestedSemester(res.current_semester);
      setForm((f) => ({ ...f, batch, semester: res.current_semester }));
      if (res.current_semester > 8) {
        setSemesterError(`Batch ${batch} has already completed all 8 semesters — there's no current semester to assign. Check "This batch has passed out" below instead.`);
      }
    } catch {
      setSuggestedSemester(null);
    }
  };

  const isPassedOutBatch = passedOutBatches.includes(form.batch) || markPassedOut;

  const lookupSubject = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) {
      setSubjectStatus("idle");
      setForm((f) => ({ ...f, subject_id: "", subject_name: "" }));
      return;
    }
    try {
      const res = await api.teacherSubjectLookup(trimmed);
      if (res.found) {
        setSubjectStatus("found");
        setForm((f) => ({ ...f, subject_id: String(res.id), subject_name: res.name }));
      } else {
        setSubjectStatus("new");
        setForm((f) => ({ ...f, subject_id: "", subject_name: "" }));
      }
    } catch {
      setSubjectStatus("idle");
    }
  };

  const updateSemester = (sem: number) => {
    if (sem > 8) {
      setSemesterError("Semester cannot be higher than 8 — a valid B.E. program has only 8 semesters.");
    } else if (suggestedSemester !== null && sem < suggestedSemester) {
      setSemesterError(`Semester cannot be lower than the automatically calculated current semester (Sem ${suggestedSemester}).`);
    } else {
      setSemesterError("");
    }
    setForm({ ...form, semester: sem });
  };

  const saveAssignment = async () => {
    if (!form.batch) { push("Select a batch", "error"); return; }

    if (isPassedOutBatch) {
      try {
        await api.teacherCreateAssignment({ batch: form.batch, passed_out: true });
        push("Passed-out batch recorded successfully.");
        setShowAddForm(false);
        setMarkPassedOut(false);
        loadAll();
      } catch (e: any) {
        push(e.message || "Could not save. Please try again.", "error");
      }
      return;
    }

    if (!form.subject_code.trim()) { push("Enter a subject code", "error"); return; }
    if (subjectStatus === "new" && !form.subject_name.trim()) { push("This subject code is new — enter its name", "error"); return; }
    if (semesterError) { push(semesterError, "error"); return; }

    const subjectPayload = subjectStatus === "found" && form.subject_id
      ? { subject_id: Number(form.subject_id) }
      : { subject_code: form.subject_code.trim(), subject_name: form.subject_name.trim() };

    try {
      await api.teacherCreateAssignment({
        batch: form.batch,
        semester: form.semester,
        section: form.section,
        ...subjectPayload,
      });
      push("Teaching assignment saved successfully.");
      setShowAddForm(false);
      setForm((f) => ({ ...f, subject_code: "", subject_name: "", subject_id: "" }));
      setSubjectStatus("idle");
      loadAll();
    } catch (e: any) {
      push(e.message || "Could not save. Please try again.", "error");
    }
  };

  const deleteAssignment = async (id: number) => {
    if (!window.confirm("Are you sure you want to remove this teaching assignment?")) return;
    try {
      await api.teacherDeleteAssignment(id);
      push("Teaching assignment removed");
      loadAll();
    } catch {
      push("Could not remove", "error");
    }
  };

  if (!teacherName || !stats) {
    return <><Topbar greeting="Loading..." subtitle="Fetching your dashboard" avatarLetter="T" /><DashboardSkeleton /></>;
  }

  return (
    <>
      <Topbar greeting={`Welcome back, ${teacherName} 👋`} subtitle="Here's what's happening in your classes today." avatarLetter={teacherName.charAt(0)} />
      <div className="p-4 md:p-8 space-y-6">
        {liveMode && <AIInsightCard fetcher={api.teacherInsight} />}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="My Students" value={stats.my_students} icon={Users} tone="brand" delay={0} onClick={openMyStudents} link="View by class →" />
          <StatCard label="My Subjects" value={stats.my_subjects} icon={BookOpen} tone="info" delay={0.05} onClick={openMySubjects} link="View list →" />
          <StatCard label="At-Risk Students" value={stats.at_risk_count} icon={AlertTriangle} tone="danger" delay={0.1} onClick={openAtRisk} link="View list →" />
          <StatCard label="Reports Generated" value={stats.reports_generated} icon={ClipboardList} tone="warning" delay={0.15} />
        </div>

        {extraWork?.extra_work && (
          <Card hover>
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <SectionTitle title="Extra Work (from HOD)" />
                <div className="flex items-center gap-2 mt-1">
                  <Badge tone="brand">{extraWork.extra_work}</Badge>
                  <Badge tone={extraWork.status === "completed" ? "success" : "warning"}>
                    {extraWork.status === "completed" ? "Completed" : "Pending"}
                  </Badge>
                </div>
              </div>
              <div className="flex gap-2">
                {extraWork.status !== "completed" ? (
                  <Button size="sm" onClick={completeExtraWork}>Mark Completed</Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={deleteExtraWork}><Trash2 size={14} /> Remove</Button>
                )}
              </div>
            </div>
          </Card>
        )}

        <Card hover>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle title="My Teaching Assignments" subtitle="Configure exactly what you teach — everything else on this portal scopes to this" />
            <Button size="sm" onClick={() => setShowAddForm(!showAddForm)}><Plus size={14} /> Add Assignment</Button>
          </div>

          {showAddForm && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className={`grid gap-2 mb-4 p-4 bg-gray-50 rounded-xl ${isPassedOutBatch ? "md:grid-cols-2" : "md:grid-cols-6"}`}>
              <div>
                <label className="text-xs text-muted block mb-1">Batch (entry year)</label>
                <input
                  list="batch-options"
                  value={form.batch}
                  onChange={(e) => setForm((f) => ({ ...f, batch: e.target.value }))}
                  onBlur={(e) => updateBatch(e.target.value)}
                  placeholder="e.g. 2023 — type to enter a new one"
                  className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                />
                <datalist id="batch-options">
                  {activeBatches.map((b) => <option key={b} value={b} />)}
                  {passedOutBatches.map((b) => <option key={`po-${b}`} value={b}>{b} (passed out)</option>)}
                </datalist>
              </div>
              {isPassedOutBatch ? (
                <div className="flex items-end">
                  <p className="text-xs text-muted italic py-1.5">This batch has passed out — no semester, section or subject needed.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-muted block mb-1">Semester {suggestedSemester !== null && <span className="text-brand">(auto: Sem {suggestedSemester})</span>}</label>
                    <input type="number" min={1} max={8} value={form.semester} onChange={(e) => updateSemester(Number(e.target.value))} className={`w-full border rounded-lg px-2 py-1.5 text-xs outline-none ${semesterError ? "border-danger" : "border-gray-200"}`} />
                    {semesterError && <p className="text-[10px] text-danger mt-1">{semesterError}</p>}
                    {form.batch && (
                      <label className="flex items-center gap-1.5 mt-1.5 text-[10px] text-muted">
                        <input type="checkbox" checked={markPassedOut} onChange={(e) => { setMarkPassedOut(e.target.checked); if (e.target.checked) setSemesterError(""); }} className="accent-brand" />
                        This batch has passed out
                      </label>
                    )}
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-1">Section</label>
                    <input value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })} placeholder="A" className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none" />
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-1">Subject code</label>
                    <input
                      list="subject-code-options"
                      value={form.subject_code}
                      onChange={(e) => { setForm((f) => ({ ...f, subject_code: e.target.value })); setSubjectStatus("idle"); }}
                      onBlur={(e) => lookupSubject(e.target.value)}
                      placeholder="e.g. CS301"
                      className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none"
                    />
                    <datalist id="subject-code-options">
                      {subjects.map((s: any) => <option key={s.id} value={s.code} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-xs text-muted block mb-1">
                      Subject name {subjectStatus === "found" && <span className="text-success">(found)</span>}
                      {subjectStatus === "new" && <span className="text-brand">(new — enter name)</span>}
                    </label>
                    <input
                      value={form.subject_name}
                      onChange={(e) => setForm((f) => ({ ...f, subject_name: e.target.value }))}
                      readOnly={subjectStatus === "found"}
                      disabled={subjectStatus === "idle"}
                      placeholder={subjectStatus === "idle" ? "Enter a code first" : "Subject name"}
                      className={`w-full border rounded-lg px-2 py-1.5 text-xs outline-none ${subjectStatus === "found" ? "bg-gray-100 border-gray-200" : "border-gray-200"}`}
                    />
                  </div>
                </>
              )}
              <div className="flex items-end">
                <Button size="sm" className="w-full" onClick={saveAssignment}>Save</Button>
              </div>
            </motion.div>
          )}

          {assignments.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">No teaching assignments configured yet — data below falls back to your subject assignments automatically.</p>
          ) : (
            <div className="space-y-1">
              {assignments.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between p-3 rounded-xl hover:bg-gray-50 transition-colors">
                  <div className="flex items-center gap-3 text-sm">
                    <Badge tone="brand">{a.batch}</Badge>
                    {a.semester !== null && <span className="text-ink">Sem {a.semester}</span>}
                    {a.section && <span className="text-muted">Section {a.section}</span>}
                    {a.subject_code && <span className="text-ink font-medium">{a.subject_code} — {a.subject_name}</span>}
                    {a.passed_out && <Badge tone="neutral">Passed Out</Badge>}
                  </div>
                  <button onClick={() => deleteAssignment(a.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          )}
        </Card>

        <AskAIBar onAsk={(q) => { push(`Opening AI Assistant for: "${q.slice(0, 40)}"`, "info"); router.push(`/teacher/assistant?q=${encodeURIComponent(q)}`); }} />
      </div>

      <CenterModal open={showAtRisk} onClose={() => setShowAtRisk(false)} title="At-Risk Students" width="max-w-2xl">
        <div className="space-y-4">
          <p className="text-xs text-muted">At risk = CGPA below your chosen threshold, or internal (IA) marks below your chosen threshold in a subject you teach them.</p>
          <PillNav
            items={[{ key: "All", label: "All" }, { key: "CGPA", label: "CGPA" }, { key: "Internal Marks", label: "Internal Marks" }, { key: "Both", label: "Both" }]}
            active={atRiskFilter}
            onChange={async (f) => { setAtRiskFilter(f); await fetchAtRisk({ filter: f }); }}
          />
          <div className="grid grid-cols-3 gap-2 p-3 bg-gray-50 rounded-xl">
            <div>
              <label className="text-xs text-muted block mb-1">Semester</label>
              <select
                value={atRiskSemester}
                onChange={async (e) => { setAtRiskSemester(e.target.value); await fetchAtRisk({ semester: e.target.value }); }}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none"
              >
                <option value="">All semesters</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((sem) => <option key={sem} value={sem}>Sem {sem}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">CGPA below</label>
              <input
                type="number" step="0.1" min={0} max={10}
                value={atRiskCgpaThreshold}
                onChange={(e) => setAtRiskCgpaThreshold(e.target.value)}
                onBlur={async () => fetchAtRisk()}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none"
              />
            </div>
            <div>
              <label className="text-xs text-muted block mb-1">Internal marks below</label>
              <input
                type="number" step="1" min={0} max={100}
                value={atRiskInternalThreshold}
                onChange={(e) => setAtRiskInternalThreshold(e.target.value)}
                onBlur={async () => fetchAtRisk()}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                className="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-xs outline-none"
              />
            </div>
          </div>
          {atRiskStudents.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted">{atRiskMessage || "No at-risk students found."}</div>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-gray-100 sticky top-0 bg-white">
                    <th className="py-2 font-medium">Student Name</th><th className="py-2 font-medium">USN</th>
                    <th className="py-2 font-medium">Sem</th><th className="py-2 font-medium">CGPA</th>
                    <th className="py-2 font-medium">Internal Marks</th>
                    <th className="py-2 font-medium">Risk Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {atRiskStudents.map((s: any) => (
                    <tr key={s.student_id} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-ink">{s.name}</td>
                      <td className="py-2 text-muted">{s.usn}</td>
                      <td className="py-2 text-muted">{s.semester ?? "—"}</td>
                      <td className="py-2">{s.cgpa ?? "—"}</td>
                      <td className="py-2">{s.internal_marks !== null ? `${s.internal_marks} (${s.subject_code})` : "—"}</td>
                      <td className="py-2"><Badge tone="danger">{s.reason_label}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </CenterModal>

      <CenterModal open={showMyStudents} onClose={() => setShowMyStudents(false)} title="My Students">
        {!myStudentsData ? (
          <p className="text-sm text-muted text-center py-6">Loading...</p>
        ) : myStudentsData.classes.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No teaching assignments configured yet.</p>
        ) : (
          <div className="space-y-4">
            <div className="text-center">
              <div className="text-2xl font-extrabold text-brand numeric">{myStudentsData.total_students}</div>
              <div className="text-xs text-muted">unique students across all your classes</div>
            </div>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {myStudentsData.classes.map((c: any) => (
                <div key={c.assignment_id} className="flex items-center justify-between p-3 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <Badge tone="brand">{c.batch}</Badge>
                    <span className="text-ink">Sem {c.semester}</span>
                    {c.section && <span className="text-muted">Sec {c.section}</span>}
                    <span className="text-ink font-medium">{c.subject_code} — {c.subject_name}</span>
                  </div>
                  <span className="text-sm font-semibold text-ink numeric shrink-0">{c.student_count} students</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CenterModal>

      <CenterModal open={showMySubjects} onClose={() => setShowMySubjects(false)} title="My Subjects">
        {!mySubjectsData ? (
          <p className="text-sm text-muted text-center py-6">Loading...</p>
        ) : mySubjectsData.subjects.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No teaching assignments configured yet.</p>
        ) : (
          <div className="space-y-2">
            {mySubjectsData.subjects.map((s: any, i: number) => (
              <div key={`${s.subject_id}-${s.semester}-${i}`} className="flex items-center justify-between p-3 rounded-xl border border-gray-100">
                <span className="text-sm font-medium text-ink">{s.subject_code} — {s.subject_name}</span>
                <Badge tone="info">Sem {s.semester}</Badge>
              </div>
            ))}
          </div>
        )}
      </CenterModal>
    </>
  );
}
