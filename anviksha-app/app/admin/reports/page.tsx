"use client";

import { useState, useEffect } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { DonutChart, SimpleBarChart } from "@/components/charts/Charts";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Send, RotateCw, Users, GraduationCap, BookOpen, FileStack, Briefcase, Award, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

export default function ReportsPage() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ text: string; rows?: any[]; chartData?: any[]; chartType?: string; aiConnected?: boolean } | null>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [snapshot, setSnapshot] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [batchInput, setBatchInput] = useState("");
  const [deptFilter, setDeptFilter] = useState("");
  const [batchError, setBatchError] = useState("");

  const loadSnapshot = async (params: Record<string, string> = {}) => {
    setBatchError("");
    try {
      const d = await api.adminSnapshotFiltered(params);
      setSnapshot(d);
      setLiveMode(true);
    } catch (e: any) {
      if (params.batch) {
        setBatchError(`Batch ${params.batch} dataset not found.`);
        setSnapshot(null);
      } else {
        setLiveMode(false);
      }
    }
  };

  useEffect(() => {
    loadSnapshot();
    api.adminDepartments().then(setDepartments).catch(() => {});
  }, []);

  const applyFilters = () => {
    const params: Record<string, string> = {};
    if (batchInput.trim()) params.batch = batchInput.trim();
    if (deptFilter) params.department_id = deptFilter;
    loadSnapshot(params);
  };

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setResult(null);

    const lower = query.toLowerCase();
    const cgpaMatch = lower.match(/(?:above|over|greater than|more than|>)\s*(\d+(\.\d+)?)|(\d+(\.\d+)?)\s*(?:cgpa|and above)/);
    const minCgpa = cgpaMatch ? parseFloat(cgpaMatch[1] || cgpaMatch[3]) : undefined;
    const noBacklogs = lower.includes("no backlog") || lower.includes("zero backlog") || lower.includes("without backlog");
    const batchMatch = lower.match(/20\d{2}/);
    const wantsActive = lower.includes("active") && !lower.includes("inactive");
    const wantsPassedOut = lower.includes("passed out") || lower.includes("graduated") || lower.includes("alumni");
    const wantsDistribution = /distribution|breakdown|split|proportion/.test(lower);
    const chartType = wantsDistribution ? "donut" : "bar";

    if (liveMode) {
      try {
        const res = await api.adminSmartQuery({
          min_cgpa: minCgpa,
          max_backlogs: noBacklogs ? 0 : undefined,
          batch: batchMatch ? batchMatch[0] : undefined,
          status: wantsActive ? "active" : wantsPassedOut ? "passed_out" : undefined,
          raw_question: query,
        });
        setResult({
          text: res.ai_answer && res.ai_connected ? res.ai_answer : `Found ${res.count} students matching that criteria.`,
          rows: res.students,
          chartData: res.chart_data,
          chartType,
          aiConnected: res.ai_connected,
        });
      } catch {
        setResult({ text: "That search could not be completed. Please try again." });
      }
      setLoading(false);
      return;
    }

    setResult({ text: "Reports are unavailable right now. Please reload the page and try again." });
    setLoading(false);
  };

  return (
    <>
      <Topbar greeting="Reports & Statistics" subtitle="Dashboard > Reports & Statistics" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Batch</label>
              <input value={batchInput} onChange={(e) => setBatchInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && applyFilters()} placeholder="Type batch year..." className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none w-40" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Department</label>
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none">
                <option value="">All Departments</option>
                {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <button onClick={applyFilters} className="bg-brand text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-brand-dark transition-colors">Apply</button>
          </div>
          {batchError && (
            <div className="mt-3 flex items-center gap-2 text-sm text-danger bg-danger/10 rounded-xl p-3">
              <AlertTriangle size={15} /> {batchError}
            </div>
          )}
        </Card>

        <Card hover className="bg-gradient-to-r from-brand to-[#7A5FEA] text-white border-none">
          <div className="flex items-center gap-2 mb-1 font-semibold text-sm"><Sparkles size={16} /> Smart query</div>
          <p className="text-xs text-white/70 mb-3">Filters and charts are built from pattern matching. The written answer is generated by a connected AI model grounded in your actual data — for example, ask "who's the top performer in 2022 batch" or "what's the highest package" and get a direct answer, not just a filtered list.</p>
          <div className="flex gap-3">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder='e.g. "students above 8.5 CGPA with no backlogs"'
              className="flex-1 bg-white/15 placeholder-white/70 text-white text-sm rounded-xl px-4 py-3 outline-none focus:bg-white/25 transition-colors"
            />
            <button onClick={run} className="bg-white text-brand text-sm font-semibold px-4 py-3 rounded-xl hover:bg-white/90 transition-colors flex items-center gap-1.5">
              {loading ? <RotateCw size={14} className="animate-spin" /> : <Send size={14} />} Run
            </button>
          </div>
          <AnimatePresence>
            {result && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mt-4 bg-white rounded-xl p-4 text-ink">
                <p className="text-sm font-medium mb-2">{result.text}</p>
                {result.chartData && result.chartData.length > 1 && (
                  <div className="mb-3 -mx-2">
                    {result.chartType === "donut" ? (
                      <DonutChart data={result.chartData.map((d: any, i: number) => ({ name: d.label, value: d.value, color: ["#5B3FD9", "#3B82F6", "#1F9D55", "#E8A93B", "#E5484D"][i % 5] }))} />
                    ) : (
                      <SimpleBarChart data={result.chartData.map((d: any) => ({ label: d.label, value: d.value }))} xKey="label" barKey="value" color="#5B3FD9" />
                    )}
                  </div>
                )}
                {result.rows && result.rows.length > 0 && (
                  <table className="w-full text-xs">
                    <thead><tr className="text-left text-muted border-b"><th className="py-1.5">Name</th><th>USN</th><th>Batch</th><th>CGPA</th><th>Backlogs</th></tr></thead>
                    <tbody>
                      {result.rows.map((s: any) => (
                        <tr key={s.usn} className="border-b border-gray-50"><td className="py-1.5">{s.name}</td><td>{s.usn}</td><td>{s.batch}</td><td>{s.cgpa?.toFixed(2)}</td><td>{s.backlogs}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>

        {snapshot && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
              {[
                { label: "Students", value: snapshot.totals.students, icon: GraduationCap },
                { label: "Active", value: snapshot.totals.active, icon: Users },
                { label: "Faculty", value: snapshot.totals.faculty, icon: Users },
                { label: "Subjects", value: snapshot.totals.subjects, icon: BookOpen },
                { label: "Pending Docs", value: snapshot.totals.pending_documents, icon: FileStack },
                { label: "Verified Certs", value: snapshot.engagement.verified_certificates, icon: Award },
              ].map((s, i) => (
                <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
                  <s.icon size={16} className="text-brand mx-auto mb-1" />
                  <div className="text-xl font-extrabold font-display text-ink numeric">{s.value}</div>
                  <div className="text-[10px] text-muted">{s.label}</div>
                </motion.div>
              ))}
            </div>

            <div className="text-xs bg-brand-light text-brand rounded-xl p-3">{snapshot.note}</div>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card hover>
                <SectionTitle title="Average CGPA by Department" subtitle="Computed per department" />
                <SimpleBarChart data={snapshot.avg_cgpa_by_department.filter((d: any) => d.avg_cgpa != null).map((d: any) => ({ label: d.department, value: d.avg_cgpa }))} xKey="label" barKey="value" color="#5B3FD9" />
              </Card>
              <Card hover>
                <SectionTitle title="Backlog Distribution" subtitle="Institute-wide" />
                <DonutChart data={snapshot.backlog_distribution.map((d: any, i: number) => ({ name: d.name, value: d.value, color: ["#1F9D55", "#E8A93B", "#F97316", "#E5484D"][i] }))} centerValue={snapshot.totals.students} centerLabel="Total" />
              </Card>
            </div>

            <Card hover>
              <SectionTitle title="Backlog Distribution by Department" subtitle="0 / 1-2 / 3-5 / 6+ backlog categories per department" />
              <div className="space-y-3">
                {snapshot.backlog_by_department.map((d: any) => (
                  <div key={d.department}>
                    <div className="text-xs font-medium text-ink mb-1">{d.department}</div>
                    <div className="flex gap-1 h-6 rounded-lg overflow-hidden">
                      {[["0", "#1F9D55"], ["1-2", "#E8A93B"], ["3-5", "#F97316"], ["6+", "#E5484D"]].map(([key, color]) => {
                        const total = d["0"] + d["1-2"] + d["3-5"] + d["6+"];
                        const pct = total ? (d[key] / total) * 100 : 0;
                        return pct > 0 ? <div key={key} style={{ width: `${pct}%`, backgroundColor: color }} title={`${key} backlogs: ${d[key]}`} /> : null;
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card hover>
              <SectionTitle title="Placement Analysis by Department" />
              {snapshot.placement_analysis_by_department.length === 0 ? (
                <p className="text-xs text-muted text-center py-8">No placement data available for the selected filters.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-muted border-b border-gray-100"><th className="py-2">Department</th><th className="py-2">Total</th><th className="py-2">Placed</th><th className="py-2">Not Placed</th><th className="py-2">Placement %</th></tr></thead>
                  <tbody>
                    {snapshot.placement_analysis_by_department.map((d: any) => (
                      <tr key={d.department} className="border-b border-gray-50">
                        <td className="py-2 font-medium text-ink">{d.department}</td>
                        <td className="py-2">{d.total}</td>
                        <td className="py-2"><Badge tone="success">{d.placed}</Badge></td>
                        <td className="py-2"><Badge tone="danger">{d.not_placed}</Badge></td>
                        <td className="py-2 numeric">{d.placement_pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>

            <Card hover>
              <SectionTitle title="Batch-wise Breakdown" />
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-gray-100">
                    <th className="py-2 font-medium">Batch</th><th className="py-2 font-medium">Total</th>
                    <th className="py-2 font-medium">Active</th><th className="py-2 font-medium">Passed Out</th><th className="py-2 font-medium">Avg CGPA</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.batch_summary.map((b: any) => (
                    <tr key={b.batch} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-ink">{b.batch}</td>
                      <td className="py-2">{b.total}</td>
                      <td className="py-2"><Badge tone="success">{b.active}</Badge></td>
                      <td className="py-2"><Badge tone="neutral">{b.passed_out}</Badge></td>
                      <td className="py-2 numeric">{b.avg_cgpa ?? "N/A"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <div className="grid lg:grid-cols-2 gap-6">
              <Card hover>
                <SectionTitle title="Placement Summary" />
                <div className="grid grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-gray-50 text-center"><div className="text-xl font-extrabold font-display numeric">{snapshot.placement_summary.tracked}</div><div className="text-[10px] text-muted">Tracked</div></div>
                  <div className="p-3 rounded-xl bg-success/10 text-center"><div className="text-xl font-extrabold font-display text-success numeric">{snapshot.placement_summary.placed}</div><div className="text-[10px] text-muted">Placed</div></div>
                  <div className="p-3 rounded-xl bg-brand-light text-center"><div className="text-xl font-extrabold font-display text-brand numeric">{snapshot.placement_summary.internships_recorded}</div><div className="text-[10px] text-muted">Internships</div></div>
                </div>
              </Card>
              <Card hover>
                <SectionTitle title="Student Engagement" />
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-gray-50 text-center"><div className="text-xl font-extrabold font-display numeric">{snapshot.engagement.course_completions}</div><div className="text-[10px] text-muted">Course Completions</div></div>
                  <div className="p-3 rounded-xl bg-gray-50 text-center"><div className="text-xl font-extrabold font-display numeric">{snapshot.totals.verified_subjects}/{snapshot.totals.subjects}</div><div className="text-[10px] text-muted">Verified Subjects</div></div>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </>
  );
}
