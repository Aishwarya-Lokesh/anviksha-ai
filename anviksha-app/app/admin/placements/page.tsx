"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { StatCard } from "@/components/ui/StatCard";
import { DonutChart, SimpleBarChart } from "@/components/charts/Charts";
import { Users, TrendingUp, Award, Briefcase, Percent } from "lucide-react";
import { api } from "@/lib/api";

export default function AdminPlacementPage() {
  const [data, setData] = useState<any>(null);
  const [departments, setDepartments] = useState<any[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [deptFilter, setDeptFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [liveMode, setLiveMode] = useState(false);

  const load = (params: Record<string, string> = {}) => {
    api.adminPlacementsFiltered(params).then((d) => { setData(d); setLiveMode(true); }).catch(() => setLiveMode(false));
  };

  useEffect(() => {
    load();
    api.adminDepartments().then(setDepartments).catch(() => {});
  }, []);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (deptFilter) params.department_id = deptFilter;
    if (yearFilter) params.passed_out_year = yearFilter;
    load(params);
  }, [deptFilter, yearFilter]);

  if (!data) return (
    <>
      <Topbar greeting="Placement Analytics" subtitle="Dashboard > Placement Analytics" avatarLetter="A" />
      <div className="p-8 text-sm text-muted">Loading...</div>
    </>
  );

  const donutData = [
    { name: "Placed (Dream)", value: data.dream_offers, color: "#5B3FD9" },
    { name: "Placed (Regular)", value: data.regular_offers, color: "#3B82F6" },
    { name: "Not Placed", value: data.not_placed, color: "#E5484D" },
  ];

  return (
    <>
      <Topbar greeting="Placement Analytics" subtitle="Dashboard > Placement Analytics" avatarLetter="A" />
      <div className="px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Live data from backend" : "○ Mock data (backend not connected)"}
        </span>
      </div>
      <div className="p-8 space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="text-[10px] text-muted block mb-1">Department</label>
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
              <option value="">All Departments</option>
              {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[10px] text-muted block mb-1">Passed Out Year</label>
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
              <option value="">All Years</option>
              {data.batches_with_data && [2024, 2025, 2026, 2027, 2028].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-warning/10 text-[#9c6b12] text-xs rounded-xl p-3">{data.note}</div>

        {data.total_students_in_placement_data === 0 ? (
          <Card className="text-center py-12" hover>
            <p className="text-sm text-muted">No placement data available for the selected filters.</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <StatCard label="Students Tracked" value={data.total_students_in_placement_data} icon={Users} tone="brand" />
              <StatCard label="Placed" value={data.placed} icon={Briefcase} tone="success" delay={0.05} />
              <StatCard label="Dream Offers" value={data.dream_offers} icon={Award} tone="info" delay={0.1} />
              <StatCard label="Regular Offers" value={data.regular_offers} icon={TrendingUp} tone="warning" delay={0.15} />
              <StatCard label="Placement Rate" value={data.placement_pct} suffix="%" icon={Percent} tone="brand" delay={0.2} />
            </div>

            {data.avg_ctc_lpa && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card hover className="text-center">
                  <div className="text-2xl font-extrabold font-display text-brand numeric">{data.avg_ctc_lpa} LPA</div>
                  <div className="text-xs text-muted mt-1">Real Average Package</div>
                </Card>
                <Card hover className="text-center">
                  <div className="text-2xl font-extrabold font-display text-success numeric">{data.highest_ctc_lpa} LPA</div>
                  <div className="text-xs text-muted mt-1">Highest Real Package</div>
                </Card>
                {data.top_companies[0] && (
                  <Card hover className="text-center col-span-2 md:col-span-2">
                    <div className="text-lg font-extrabold font-display text-ink">{data.top_companies[0].company}</div>
                    <div className="text-xs text-muted mt-1">Top Hiring Company ({data.top_companies[0].count})</div>
                  </Card>
                )}
              </div>
            )}

            {data.offer_tiers_by_ctc && data.offer_tiers_by_ctc.classifiable_count > 0 && (
              <Card hover>
                <SectionTitle title="Offer Tiers by Real Package" subtitle="Regular < 6 LPA · Dream 6-10 LPA · Super Dream > 10 LPA — classified from real CTC values" />
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 rounded-xl bg-gray-50">
                    <div className="text-2xl font-extrabold font-display text-ink numeric">{data.offer_tiers_by_ctc.regular}</div>
                    <div className="text-xs text-muted mt-1">Regular Offers</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-info/10">
                    <div className="text-2xl font-extrabold font-display text-info numeric">{data.offer_tiers_by_ctc.dream}</div>
                    <div className="text-xs text-muted mt-1">Dream Offers</div>
                  </div>
                  <div className="text-center p-4 rounded-xl bg-brand-light">
                    <div className="text-2xl font-extrabold font-display text-brand numeric">{data.offer_tiers_by_ctc.super_dream}</div>
                    <div className="text-xs text-muted mt-1">Super Dream Offers</div>
                  </div>
                </div>
                <p className="text-[10px] text-muted mt-3 text-center">Based on {data.offer_tiers_by_ctc.classifiable_count} real records with a known package value.</p>
              </Card>
            )}

            <div className="grid lg:grid-cols-2 gap-6">
              <Card hover>
                <SectionTitle title="Placement Breakdown" />
                <DonutChart data={donutData} centerValue={data.placed} centerLabel="Placed" />
              </Card>
              <Card hover>
                <SectionTitle title="Department-wise Placement Analysis" subtitle="Total vs. Placed students per department" />
                {data.by_department && data.by_department.length > 0 ? (
                  <SimpleBarChart data={data.by_department.map((d: any) => ({ label: d.department, value: d.placed }))} xKey="label" barKey="value" color="#1F9D55" />
                ) : (
                  <p className="text-xs text-muted text-center py-8">No department breakdown available for this filter.</p>
                )}
              </Card>
            </div>

            {data.top_companies && data.top_companies.length > 0 && (
              <Card hover>
                <SectionTitle title="Top Hiring Companies" subtitle="Real, from your placement records" />
                <div className="grid md:grid-cols-2 gap-2">
                  {data.top_companies.slice(0, 6).map((c: any) => (
                    <div key={c.company} className="flex items-center justify-between text-sm p-2 rounded-lg hover:bg-gray-50">
                      <span className="text-ink">{c.company}</span>
                      <Badge tone="brand">{c.count} students</Badge>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            <Card hover>
              <SectionTitle title="Student Placement Records" />
              <div className="overflow-y-auto max-h-80">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted border-b border-gray-100 sticky top-0 bg-white">
                      <th className="py-2 font-medium">Name</th><th className="py-2 font-medium">USN</th>
                      <th className="py-2 font-medium">Status</th><th className="py-2 font-medium">Company</th><th className="py-2 font-medium">CTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((s: any) => (
                      <tr key={s.usn} className="border-b border-gray-50">
                        <td className="py-2 font-medium text-ink">{s.name}</td>
                        <td className="py-2 text-muted">{s.usn}</td>
                        <td className="py-2"><Badge tone={s.placed ? "success" : "warning"}>{s.placed ? "Placed" : "Not Placed"}</Badge></td>
                        <td className="py-2 text-muted">{s.company || "—"}</td>
                        <td className="py-2 text-muted">{s.ctc || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
