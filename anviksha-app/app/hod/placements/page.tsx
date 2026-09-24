"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { StatCard } from "@/components/ui/StatCard";
import { PillNav } from "@/components/ui/Tabs";
import { DonutChart, SimpleBarChart } from "@/components/charts/Charts";
import { Briefcase, Users, Award, TrendingUp, Building2, Download } from "lucide-react";
import { api } from "@/lib/api";
import { downloadExcel } from "@/lib/fileGen";
import { useToast } from "@/components/ui/Toaster";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { PlacementFunnelSection } from "@/components/hod-intelligence/PlacementFunnelSection";

export default function HodPlacementsPage() {
  const [data, setData] = useState<any>(null);
  const [placementBatches, setPlacementBatches] = useState<{ batch: string; label: string }[]>([]);
  const [activeBatch, setActiveBatch] = useState<string>("All");
  const [liveMode, setLiveMode] = useState(false);

  const [compareSelected, setCompareSelected] = useState<Set<string>>(new Set());
  const [comparison, setComparison] = useState<any[] | null>(null);
  const { push } = useToast();

  useEffect(() => {
    api.hodPlacements().then((d) => { setData(d); setLiveMode(true); }).catch(() => {});
    api.hodPlacementBatches().then((rows) => {
      setPlacementBatches(rows);
      setCompareSelected(new Set(rows.map((r: any) => r.batch)));
    }).catch(() => {});
  }, []);

  const changeBatch = (b: string) => {
    setActiveBatch(b);
    const fetcher = b === "All" ? api.hodPlacements() : api.hodPlacements(b);
    fetcher.then(setData).catch(() => {});
  };

  const runComparison = () => {
    if (compareSelected.size < 2) { push("Select at least 2 batches to compare", "error"); return; }
    api.hodPlacementComparison(Array.from(compareSelected)).then(setComparison).catch(() => {});
  };

  useEffect(() => {
    if (placementBatches.length > 0 && compareSelected.size >= 2) runComparison();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementBatches]);

  const toggleCompare = (b: string) => {
    setCompareSelected((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b); else next.add(b);
      return next;
    });
  };

  const downloadReport = () => {
    if (!data || !data.students) return;
    const placed = data.students.filter((s: any) => s.placed);
    if (placed.length === 0) { push("No placed students to export for this batch", "error"); return; }
    downloadExcel(
      placed.map((s: any) => ({ Name: s.name, USN: s.usn, Company: s.company || "—", "CTC/Package": s.ctc || "—", Batch: s.batch || "—" })),
      `Placement_Report_${activeBatch === "All" ? "All_Batches" : activeBatch}`,
      "Placements"
    );
    push("Placement report downloaded");
  };

  if (!data) return <><Topbar greeting="Placement Analytics" subtitle="Loading..." avatarLetter="H" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="Placement Analytics" subtitle={`Dashboard > Placement Analytics — ${data.department}`} avatarLetter="H" />
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs font-medium text-muted">Batch:</span>
            <PillNav
              items={[{ key: "All", label: "All" }, ...placementBatches.map((b) => ({ key: b.batch, label: b.label }))]}
              active={activeBatch}
              onChange={changeBatch}
            />
          </div>
          <Button variant="secondary" onClick={downloadReport}><Download size={15} /> Download Report</Button>
        </div>

        {data.tracked_total === 0 ? (
          <Card className="text-center py-12" hover>
            <p className="text-sm text-muted">No students found for {data.department} — {data.batch_label}.</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard label="Tracked" value={data.tracked_total} icon={Users} tone="brand" />
              <StatCard label="Placed" value={data.placed} icon={Briefcase} tone="success" delay={0.05} />
              <StatCard label="Dream Offers (≥9 LPA)" value={data.dream_offers} icon={Award} tone="info" delay={0.1} />
              <StatCard label="Regular Offers (<9 LPA)" value={data.regular_offers} icon={TrendingUp} tone="warning" delay={0.15} />
            </div>

            {data.avg_ctc_lpa ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card hover className="text-center">
                  <div className="text-2xl font-extrabold font-display text-brand numeric">{data.avg_ctc_lpa} LPA</div>
                  <div className="text-xs text-muted mt-1">Real Average Package — placed students with company + CTC data</div>
                </Card>
                <Card hover className="text-center">
                  <div className="text-2xl font-extrabold font-display text-ink numeric">{data.companies_hired_count}</div>
                  <div className="text-xs text-muted mt-1">Companies That Hired This Batch</div>
                </Card>
                {data.highest_package_company && (
                  <Card hover className="text-center">
                    <div className="text-sm font-extrabold font-display text-ink truncate">{data.highest_package_company.company}</div>
                    <div className="text-xs text-success font-semibold mt-0.5">{data.highest_package_company.ctc}</div>
                    <div className="text-xs text-muted mt-1">Highest Package Offered ({data.highest_package_company.students_placed} placed there)</div>
                  </Card>
                )}
                {data.top_hiring_company && (
                  <Card hover className="text-center">
                    <div className="text-sm font-extrabold font-display text-ink truncate">{data.top_hiring_company.company}</div>
                    <div className="text-xs text-success font-semibold mt-0.5">{data.top_hiring_company.ctc || "—"}</div>
                    <div className="text-xs text-muted mt-1">Top Hiring Company ({data.top_hiring_company.students_placed} placed there)</div>
                  </Card>
                )}
              </div>
            ) : (
              <div className="text-xs bg-warning/10 text-[#9c6b12] rounded-xl p-3">
                Company and CTC data isn't available for this batch in the current dataset — status only.
              </div>
            )}

            <div className="grid lg:grid-cols-2 gap-6">
              <Card hover>
                <SectionTitle title="Department Placement Breakdown" subtitle="Placed vs not placed, this batch" />
                <DonutChart data={[
                  { name: "Placed", value: data.placed, color: "#1F9D55" },
                  { name: "Not Placed", value: data.not_placed, color: "#E5484D" },
                ]} centerValue={data.tracked_total} centerLabel="Tracked" />
              </Card>
              {data.top_companies && data.top_companies.length > 0 && (
                <Card hover>
                  <SectionTitle title="Top Hiring Companies" subtitle="Every company that hired this batch, most students first" />
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {data.top_companies.map((c: any) => (
                      <div key={c.company} className="flex items-center justify-between text-sm">
                        <span className="text-ink flex items-center gap-1.5"><Building2 size={13} className="text-muted" /> {c.company}</span>
                        <Badge tone="brand">{c.count} student{c.count === 1 ? "" : "s"}</Badge>
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>

            {data.students_placed_for_highest_package && data.students_placed_for_highest_package.length > 0 && (
              <Card hover>
                <SectionTitle title="Students Placed for Highest Package" subtitle="Dream offers (≥9 LPA) in this batch, highest package first" />
                <div className="space-y-2">
                  {data.students_placed_for_highest_package.map((t: any) => (
                    <div key={t.usn} className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                      <div>
                        <div className="text-sm font-medium text-ink">{t.name}</div>
                        <div className="text-xs text-muted">{t.usn} · {t.company}</div>
                      </div>
                      <span className="text-sm font-bold text-success numeric">{t.ctc}</span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )}

        {placementBatches.length >= 2 && (
          <Card hover>
            <SectionTitle title="Compare Batches" subtitle="Pick two or more batches to compare placement rate and average package" />
            <div className="flex flex-wrap gap-2 mb-4">
              {placementBatches.map((b) => (
                <button
                  key={b.batch}
                  onClick={() => toggleCompare(b.batch)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${compareSelected.has(b.batch) ? "bg-brand text-white border-brand" : "bg-white text-muted border-gray-200"}`}
                >
                  {b.label}
                </button>
              ))}
              <Button size="sm" onClick={runComparison}>Compare</Button>
            </div>
            {comparison && comparison.length >= 2 ? (
              <div className="grid md:grid-cols-2 gap-6">
                <div>
                  <div className="text-xs font-medium text-muted mb-2 text-center">Placement Rate by Batch</div>
                  <SimpleBarChart
                    data={comparison.map((c: any) => ({ label: c.label, value: c.placement_pct ?? 0 }))}
                    xKey="label" barKey="value" color="#1F9D55"
                    yLabel="% Placed" valueSuffix="%" showValues
                  />
                </div>
                <div>
                  <div className="text-xs font-medium text-muted mb-2 text-center">Average Package by Batch</div>
                  <SimpleBarChart
                    data={comparison.map((c: any) => ({ label: c.label, value: c.avg_ctc_lpa ?? 0 }))}
                    xKey="label" barKey="value" color="#5B3FD9"
                    yLabel="LPA" valueSuffix=" LPA" showValues
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted text-center py-6">Select 2 or more batches above and click Compare.</p>
            )}
          </Card>
        )}

        <PlacementFunnelSection />
      </div>
    </>
  );
}
