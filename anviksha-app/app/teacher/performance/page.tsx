"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { StatCard } from "@/components/ui/StatCard";
import { PillNav } from "@/components/ui/Tabs";
import { DonutChart, SimpleBarChart } from "@/components/charts/Charts";
import { CenterModal } from "@/components/ui/Modal";
import { motion } from "framer-motion";
import { Users, TrendingUp, AlertTriangle, GraduationCap } from "lucide-react";
import { api } from "@/lib/api";
import { useSearchParams } from "next/navigation";
import { TeacherFeedback } from "@/components/feedback/TeacherFeedback";

const MODES = [
  { key: "subject", label: "My Subject" },
  { key: "overall", label: "CGPA Performance" },
  { key: "achievements", label: "CGPA & Achievements" },
];

const DISTRIBUTION_INFO: Record<string, { title: string; subtitle: string; xLabel: string; yLabel: string; suffix: string }> = {
  subject: {
    title: "IA Marks Distribution",
    subtitle: "How many students fall into each internal-marks score band, for this subject",
    xLabel: "IA marks (% of max)",
    yLabel: "Number of students",
    suffix: "",
  },
  overall: {
    title: "CGPA Distribution",
    subtitle: "How many students fall into each CGPA range, this semester",
    xLabel: "CGPA range",
    yLabel: "Number of students",
    suffix: "",
  },
  achievements: {
    title: "Excellence Score Distribution",
    subtitle: "How many students fall into each Profile/Excellence Score band (CGPA points + achievement points)",
    xLabel: "Score range",
    yLabel: "Number of students",
    suffix: "",
  },
};

export default function PerformancePage() {
  const [batches, setBatches] = useState<string[]>([]);
  const [batch, setBatch] = useState<string>("");
  const [semesters, setSemesters] = useState<number[]>([]);
  const [semester, setSemester] = useState<number | null>(null);
  const [mode, setMode] = useState("achievements");
  // "Student feedback" can be linked to directly with ?view=feedback
  const linkedView = useSearchParams().get("view");
  const [view, setView] = useState(linkedView === "feedback" ? "feedback" : "performance");
  useEffect(() => { if (linkedView === "feedback") setView("feedback"); }, [linkedView]);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState<number | null>(null);
  const [data, setData] = useState<any>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [showBacklogs, setShowBacklogs] = useState(false);
  const [backlogStudents, setBacklogStudents] = useState<any[]>([]);

  useEffect(() => {
    api.teacherMyBatches().then((b) => { setBatches(b); if (b.length) setBatch(b[0]); setLiveMode(true); }).catch(() => setLiveMode(false));
    api.teacherSubjects().then(setSubjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (batch) api.teacherAvailableSemesters(batch).then((s) => { setSemesters(s); if (s.length) setSemester(s[0]); }).catch(() => {});
  }, [batch]);

  useEffect(() => {
    if (semester != null && batch) {
      api.teacherPerformanceV2(semester, mode, mode === "subject" ? (subjectId ?? undefined) : undefined, batch).then(setData).catch(() => {});
    }
  }, [batch, semester, mode, subjectId]);

  useEffect(() => {
    if (semester != null && subjects.length) {
      const match = subjects.find((s: any) => s.semester === semester);
      setSubjectId(match ? match.id : null);
    }
  }, [semester, subjects]);

  const openBacklogs = async () => {
    if (semester == null || !batch) return;
    const rows = await api.teacherStudentsWithBacklogs(semester, batch);
    setBacklogStudents(rows);
    setShowBacklogs(true);
  };

  return (
    <>
      <Topbar greeting="Performance & Feedback" subtitle="Dashboard > Performance & Feedback" avatarLetter="T" />
      <div className="px-4 md:px-8 pt-4 md:pt-6">
        <PillNav items={[{ key: "performance", label: "Student performance" }, { key: "feedback", label: "Student feedback" }]} active={view} onChange={setView} />
      </div>
      {view === "feedback" && <div className="p-4 md:p-8"><TeacherFeedback /></div>}
      <div className={`p-4 md:p-8 space-y-6 ${view === "feedback" ? "hidden" : ""}`}>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-muted">Batch:</span>
          <PillNav items={batches.map((b) => ({ key: b, label: `${b} Batch` }))} active={batch} onChange={setBatch} />
        </div>
        <PillNav items={semesters.map((s) => ({ key: String(s), label: `Sem ${s}` }))} active={String(semester)} onChange={(k) => setSemester(Number(k))} />

        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-medium text-muted">Performance Based On:</span>
          <PillNav items={MODES} active={mode} onChange={setMode} />
          {mode === "subject" && (
            <select value={subjectId ?? ""} onChange={(e) => setSubjectId(Number(e.target.value))} className="border border-gray-200 rounded-xl px-3 py-1.5 text-xs outline-none">
              {subjects.filter((s: any) => s.semester === semester).map((s: any) => <option key={s.id} value={s.id}>{s.code}</option>)}
            </select>
          )}
        </div>

        {!data ? (
          <div className="text-sm text-muted py-10 text-center">Loading cohort data...</div>
        ) : (
          <>
            <div className="bg-brand-light text-brand text-xs rounded-xl p-3">{data.mode_note}</div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <StatCard label="Cohort Size" value={data.cohort_size} icon={Users} tone="brand" />
              <StatCard label="Avg CGPA" value={data.avg_cgpa || 0} decimals={2} icon={GraduationCap} tone="success" delay={0.05} />
              <div onClick={openBacklogs} className="cursor-pointer">
                <StatCard label="Students With Backlogs" value={data.backlogs_count} icon={AlertTriangle} tone="danger" delay={0.1} />
              </div>
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card hover>
                <SectionTitle title={DISTRIBUTION_INFO[mode].title} subtitle={DISTRIBUTION_INFO[mode].subtitle} />
                <SimpleBarChart
                  data={data.distribution.map((d: any) => ({ label: d.name, value: d.value }))}
                  xKey="label"
                  barKey="value"
                  color="#3B82F6"
                  xLabel={DISTRIBUTION_INFO[mode].xLabel}
                  yLabel={DISTRIBUTION_INFO[mode].yLabel}
                  valueSuffix={DISTRIBUTION_INFO[mode].suffix}
                  showValues
                />
                <p className="text-[11px] text-muted mt-1 text-center">Each bar is one {DISTRIBUTION_INFO[mode].xLabel.toLowerCase()} — its height is the number of students in that range.</p>
              </Card>
              <Card hover>
                <SectionTitle
                  title="Top Performers"
                  subtitle={
                    mode === "achievements" ? "Excellence Score ranking (CGPA points + achievement points)"
                    : mode === "subject" ? "Internal (IA) marks ranking for this subject"
                    : "CGPA ranking, this semester"
                  }
                />
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {(
                    mode === "achievements" ? (data.top_performers_achievements || [])
                    : mode === "subject" ? (data.top_performers_subject || [])
                    : data.top_performers
                  ).length === 0 ? (
                    <p className="text-sm text-muted text-center py-8">
                      {mode === "subject" ? "No IA marks entered yet for this subject." : "No data yet."}
                    </p>
                  ) : (
                    mode === "achievements" ? data.top_performers_achievements
                    : mode === "subject" ? data.top_performers_subject
                    : data.top_performers
                  ).map((s: any, i: number) => (
                    <motion.div key={s.usn} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.05 }} className="flex items-center justify-between p-2 rounded-xl hover:bg-gray-50">
                      <div className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-brand-light text-brand text-xs font-bold flex items-center justify-center">{i + 1}</div>
                        <div>
                          <div className="text-sm font-medium text-ink">{s.name}</div>
                          <div className="text-xs text-muted">{s.usn}</div>
                        </div>
                      </div>
                      <span className="text-sm font-semibold text-ink numeric">
                        {mode === "achievements" ? `${s.total_score} pts`
                          : mode === "subject" ? `${s.internal_marks_pct}%`
                          : s.cgpa?.toFixed(2)}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </Card>
            </div>
          </>
        )}
      </div>

      <CenterModal open={showBacklogs} onClose={() => setShowBacklogs(false)} title={`Students With Backlogs — Sem ${semester}`}>
        {backlogStudents.length === 0 ? (
          <p className="text-sm text-muted text-center py-4">No students with backlogs in this semester.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted border-b"><th className="py-1.5">USN</th><th>Name</th><th>Backlogs</th></tr></thead>
            <tbody>
              {backlogStudents.map((s: any) => (
                <tr key={s.usn} className="border-b border-gray-50"><td className="py-1.5">{s.usn}</td><td>{s.name}</td><td><Badge tone="danger">{s.backlogs}</Badge></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </CenterModal>
    </>
  );
}
