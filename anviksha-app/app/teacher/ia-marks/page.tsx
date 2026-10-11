"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { Save, Check } from "lucide-react";
import { api } from "@/lib/api";

export default function IaMarksPage() {
  const [batches, setBatches] = useState<string[]>([]);
  const [batch, setBatch] = useState<string>("");
  const [semesters, setSemesters] = useState<number[]>([]);
  const [semester, setSemester] = useState<number | null>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    api.teacherMyBatches().then((b) => { setBatches(b); if (b.length) setBatch(b[0]); }).catch(() => {});
    api.teacherSubjects().then(setSubjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (batch) api.teacherAvailableSemesters(batch).then((s) => { setSemesters(s); if (s.length) setSemester(s[0]); }).catch(() => {});
  }, [batch]);

  useEffect(() => {
    if (semester && subjects.length) {
      const match = subjects.find((s: any) => s.semester === semester);
      setSubjectId(match ? match.id : null);
    }
  }, [semester, subjects]);

  useEffect(() => {
    if (subjectId && semester && batch) {
      api.teacherMarks(subjectId, semester, batch).then(setRows).catch(() => setRows([]));
      setEdits({});
    }
  }, [subjectId, semester, batch]);

  const editedCount = Object.keys(edits).length;

  const saveAll = async () => {
    if (!subjectId || editedCount === 0) return;
    setSaving(true);
    try {
      const payload = Object.entries(edits)
        .filter(([, value]) => value !== "")
        .map(([key, value]) => {
          const [studentId, ...examParts] = key.split("-");
          return { student_id: Number(studentId), subject_id: subjectId, exam_type: examParts.join("-"), marks_obtained: Number(value), max_marks: 50 };
        });
      const res = await api.teacherSaveMarksBulk(payload);
      push(`${res.count} mark(s) saved`);
      const updated = await api.teacherMarks(subjectId, semester!, batch);
      setRows(updated);
      setEdits({});
    } catch {
      push("Save failed — check backend connection", "error");
    }
    setSaving(false);
  };

  const subjectsForSemester = subjects.filter((s: any) => s.semester === semester);

  return (
    <>
      <Topbar greeting="IA Marks" subtitle="Dashboard > IA Marks" avatarLetter="T" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <div className="grid md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Batch (entry year)</label>
              <select value={batch} onChange={(e) => setBatch(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none">
                {batches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Semester (only yours)</label>
              <select value={semester ?? ""} onChange={(e) => setSemester(Number(e.target.value))} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none">
                {semesters.map((s) => <option key={s} value={s}>Sem {s}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Subject (only yours, for this semester)</label>
              <select value={subjectId ?? ""} onChange={(e) => setSubjectId(Number(e.target.value))} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none">
                {subjectsForSemester.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
          </div>
        </Card>

        <Card hover>
          <div className="flex items-center justify-between mb-1">
            <SectionTitle title={`IA Marks — ${batch} Batch, Sem ${semester || ""}`} subtitle="Enter marks for as many students as you like, then save them all at once" />
            <Button onClick={saveAll} disabled={saving || editedCount === 0}>
              {saving ? <><motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.6 }} className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full" /> Saving...</> : <><Save size={14} /> Save All{editedCount > 0 ? ` (${editedCount})` : ""}</>}
            </Button>
          </div>
          {rows.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">No students found for this semester/subject.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-gray-100">
                  <th className="py-2 font-medium">USN</th><th className="py-2 font-medium">Name</th>
                  <th className="py-2 font-medium">IA 1</th><th className="py-2 font-medium">IA 2</th><th className="py-2 font-medium">IA 3</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.student_id} className="border-b border-gray-50">
                    <td className="py-2 text-muted">{r.usn}</td>
                    <td className="py-2 font-medium text-ink">{r.name}</td>
                    {["ia1", "ia2", "ia3"].map((ia, i) => {
                      const examType = `IA-${i + 1}`;
                      const key = `${r.student_id}-${examType}`;
                      const existing = r[ia];
                      return (
                        <td key={ia} className="py-2">
                          <input
                            type="number"
                            defaultValue={existing?.marks ?? ""}
                            placeholder="—"
                            onChange={(e) => setEdits({ ...edits, [key]: e.target.value })}
                            className={`w-16 border rounded-lg px-2 py-1 text-xs outline-none ${key in edits ? "border-brand bg-brand-light/30" : "border-gray-200"}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
