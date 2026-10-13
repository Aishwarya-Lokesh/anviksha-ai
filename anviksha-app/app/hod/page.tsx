"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { DonutChart, SimpleBarChart } from "@/components/charts/Charts";
import { CenterModal } from "@/components/ui/Modal";
import { GraduationCap, Users, Activity } from "lucide-react";
import { api } from "@/lib/api";
import { useUrlState } from "@/lib/useUrlState";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { AIInsightCard } from "@/components/ui/AIInsightCard";
import { LiveAttendanceSection } from "@/components/hod-intelligence/LiveAttendanceSection";
import { DepartmentHealthSnapshot } from "@/components/hod-intelligence/DepartmentHealthSnapshot";
import { DepartmentBriefingCard } from "@/components/hod-intelligence/DepartmentBriefingCard";

export default function HodDashboard() {
  const [me, setMe] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [workload, setWorkload] = useState<any[]>([]);
  const [liveMode, setLiveMode] = useState(false);

  const [batchBreakdown, setBatchBreakdown] = useState<any[]>([]);
  const [showTotalStudents, setShowTotalStudents] = useState(false);
  const [showActive, setShowActive] = useState(false);
  const [showFaculty, setShowFaculty] = useState(false);
  const [facultyList, setFacultyList] = useState<any[]>([]);

  const [urlParams, setUrlParams] = useUrlState();
  const backlogBatch = urlParams.get("backlog_batch") || "";
  const topperfBatch = urlParams.get("top_batch") || "";
  const setBacklogBatch = (b: string) => setUrlParams({ backlog_batch: b || null });
  const setTopperfBatch = (b: string) => setUrlParams({ top_batch: b || null });
  const [topperfLimitChoice, setTopperfLimitChoice] = useState("5");
  const [topperfCustom, setTopperfCustom] = useState("5");

  useEffect(() => {
    api.hodMe().then(setMe).catch(() => {});
    api.hodFacultyWorkload().then(setWorkload).catch(() => {});
    api.hodStudentsByBatch().then(setBatchBreakdown).catch(() => {});
  }, []);

  const topperfLimit = topperfLimitChoice === "custom" ? Number(topperfCustom) || 5 : Number(topperfLimitChoice);

  useEffect(() => {
    api.hodStats({ backlogBatch: backlogBatch || undefined, topperfBatch: topperfBatch || undefined, topperfLimit })
      .then((d) => { setStats(d); setLiveMode(true); })
      .catch(() => {});
  }, [backlogBatch, topperfBatch, topperfLimit]);

  const openTotalStudents = () => setShowTotalStudents(true);
  const openActive = () => setShowActive(true);
  const openFaculty = async () => {
    if (facultyList.length === 0) {
      const rows = await api.hodFaculty();
      setFacultyList(rows);
    }
    setShowFaculty(true);
  };

  if (!stats) return <><Topbar greeting="Head of Department" subtitle="Loading your department…" avatarLetter="H" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting={me?.title || "Head of Department"} subtitle={`Department: ${stats.department} — scoped to your department only`} avatarLetter="H" />
      <div className="p-4 md:p-8 space-y-6">
        {liveMode && <AIInsightCard fetcher={api.hodInsight} />}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatCard label="Total Students" value={stats.total_students} icon={GraduationCap} tone="brand" onClick={openTotalStudents} link="View by batch →" />
          <StatCard label="Active" value={stats.active_students} icon={Activity} tone="success" delay={0.05} onClick={openActive} link="View by batch →" />
          <StatCard label="Faculty" value={stats.total_faculty} icon={Users} tone="info" delay={0.1} onClick={openFaculty} link="View list →" />
        </div>

        <DepartmentBriefingCard />

        <DepartmentHealthSnapshot cgpaBySemester={stats.cgpa_by_semester} />

        <LiveAttendanceSection />

        <div className="grid lg:grid-cols-2 gap-6">
          <Card hover>
            <SectionTitle title="Students — Active vs Passed Out" subtitle="Your department" />
            <DonutChart data={[
              { name: "Active", value: stats.active_students, color: "#1F9D55" },
              { name: "Passed Out", value: stats.passed_out_students, color: "#6B7280" },
            ]} centerValue={stats.total_students} centerLabel="Total" />
          </Card>
          <Card hover>
            <SectionTitle title="Subjects Handled by Faculty" subtitle="From each teacher's own Teaching Assignments" />
            <SimpleBarChart data={workload.map((w) => ({ label: w.name, value: w.subject_count }))} xKey="label" barKey="value" color="#5B3FD9" />
          </Card>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card hover>
            <SectionTitle title="Average CGPA by Batch" subtitle="Active batches in this department" />
            {stats.cgpa_by_batch && stats.cgpa_by_batch.length > 0 ? (
              <SimpleBarChart
                data={stats.cgpa_by_batch.map((s: any) => ({ label: s.batch, value: s.avg_cgpa }))}
                xKey="label" barKey="value" color="#1F9D55"
                xLabel="Batch" yLabel="Avg CGPA" showValues
              />
            ) : (
              <p className="text-xs text-muted text-center py-8">No CGPA data available yet.</p>
            )}
          </Card>
          <Card hover>
            <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
              <SectionTitle title="Backlog Distribution" subtitle={backlogBatch ? `Batch ${backlogBatch} — active students` : "All active students, department-wide"} />
              <select value={backlogBatch} onChange={(e) => setBacklogBatch(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none">
                <option value="">All batches</option>
                {batchBreakdown.map((b: any) => <option key={b.batch} value={b.batch}>{b.batch}</option>)}
              </select>
            </div>
            {stats.backlog_distribution && stats.backlog_active_count > 0 ? (
              <DonutChart data={stats.backlog_distribution.map((b: any, i: number) => ({ name: b.name, value: b.value, color: ["#1F9D55", "#E8A93B", "#F97316", "#E5484D"][i] }))} centerValue={stats.backlog_active_count} centerLabel="Active" />
            ) : (
              <p className="text-xs text-muted text-center py-8">No active students in this batch.</p>
            )}
          </Card>
        </div>

        <Card hover>
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <SectionTitle
              title="Department Top Performers"
              subtitle={topperfBatch ? `Batch ${topperfBatch}${stats.top_performers_is_passed_out_batch ? " — passed out batch" : ""}, ranked by CGPA` : "Ranked by CGPA — active students, department-wide"}
            />
            <div className="flex items-center gap-2 flex-wrap">
              <select value={topperfBatch} onChange={(e) => setTopperfBatch(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none">
                <option value="">All active students</option>
                {batchBreakdown.map((b: any) => <option key={b.batch} value={b.batch}>{b.batch}{b.passed_out > 0 && b.active === 0 ? " (passed out)" : ""}</option>)}
              </select>
              <select value={topperfLimitChoice} onChange={(e) => setTopperfLimitChoice(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none">
                <option value="5">Top 5</option>
                <option value="10">Top 10</option>
                <option value="20">Top 20</option>
                <option value="custom">Custom...</option>
              </select>
              {topperfLimitChoice === "custom" && (
                <input
                  type="number" min={1} value={topperfCustom}
                  onChange={(e) => setTopperfCustom(e.target.value)}
                  className="border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none w-16"
                />
              )}
            </div>
          </div>
          {topperfBatch && stats.top_performers_is_passed_out_batch && (
            <div className="text-xs bg-gray-100 text-muted rounded-lg px-3 py-1.5 mb-2 inline-block">Passed out batch — showing their final CGPA ranking</div>
          )}
          {stats.top_performers && stats.top_performers.length > 0 ? (
            <div className="space-y-1">
              {stats.top_performers.map((s: any) => (
                <div key={s.usn} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded-full bg-brand-light text-brand text-xs font-bold flex items-center justify-center">{s.rank}</div>
                    <div>
                      <div className="text-sm font-medium text-ink">{s.name}</div>
                      <div className="text-xs text-muted">{s.usn} · Sem {s.semester} · Batch {s.batch}</div>
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-ink numeric">{s.cgpa?.toFixed(2)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted text-center py-8">No CGPA data available yet.</p>
          )}
        </Card>
      </div>

      <CenterModal open={showTotalStudents} onClose={() => setShowTotalStudents(false)} title="Total Students by Batch">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-gray-100 sticky top-0 bg-white">
                <th className="py-2 font-medium">Batch</th><th className="py-2 font-medium">Active</th>
                <th className="py-2 font-medium">Passed Out</th><th className="py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {batchBreakdown.map((b: any) => (
                <tr key={b.batch} className="border-b border-gray-50">
                  <td className="py-2 font-medium text-ink">{b.batch}</td>
                  <td className="py-2"><Badge tone="success">{b.active}</Badge></td>
                  <td className="py-2"><Badge tone="neutral">{b.passed_out}</Badge></td>
                  <td className="py-2 numeric font-semibold">{b.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CenterModal>

      <CenterModal open={showActive} onClose={() => setShowActive(false)} title="Active Students by Batch">
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-gray-100 sticky top-0 bg-white">
                <th className="py-2 font-medium">Batch</th><th className="py-2 font-medium">Active Students</th>
              </tr>
            </thead>
            <tbody>
              {batchBreakdown.filter((b: any) => b.active > 0).map((b: any) => (
                <tr key={b.batch} className="border-b border-gray-50">
                  <td className="py-2 font-medium text-ink">{b.batch}</td>
                  <td className="py-2"><Badge tone="success">{b.active}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CenterModal>

      <CenterModal open={showFaculty} onClose={() => setShowFaculty(false)} title="Department Faculty">
        <div className="max-h-96 overflow-y-auto space-y-1">
          {facultyList.map((f: any) => (
            <div key={f.id} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-50">
              <span className="text-sm font-medium text-ink">{f.name}</span>
              <Badge tone="brand">{f.designation || "—"}</Badge>
            </div>
          ))}
        </div>
      </CenterModal>
    </>
  );
}
