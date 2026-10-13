"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { MetricExplain } from "@/components/ui/MetricExplain";
import { HorizontalBarChart } from "@/components/charts/hod-intelligence/HorizontalBarChart";
import { StudentRadarChart } from "@/components/charts/Charts";
import { hodIntelligenceApi } from "@/lib/hodIntelligenceApi";
import { api } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { Download } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { useUrlState } from "@/lib/useUrlState";

/**
 * Phase 4 — Subject / Assessment Analytics. New page, new nav item.
 * "Repeat-offender subjects" (cross-referencing backlogs to a specific
 * subject) is intentionally NOT built: Student.backlogs is a single stored
 * total with zero subject-level attribution anywhere in the schema — there
 * is no real way to know WHICH subject a backlog belongs to, so building
 * this would mean fabricating an attribution the data doesn't support. See
 * docs/hod-intelligence/PROGRESS.md, Phase 4 notes, for the full reasoning.
 */
export default function AssessmentAnalyticsPage() {
  const [outliers, setOutliers] = useState<any>(null);
  const [bloom, setBloom] = useState<any>(null);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [urlParams, setUrlParams] = useUrlState();
  const selectedSubjectId: number | "" = Number(urlParams.get("subject")) || "";
  const setSelectedSubjectId = (id: number | "") => { setSectionComparison(null); setUrlParams({ subject: id ? String(id) : null }); };
  const [sectionComparison, setSectionComparison] = useState<any>(null);

  useEffect(() => {
    hodIntelligenceApi.passRateOutliers().then(setOutliers).catch(() => setOutliers({ status: "unavailable" }));
    hodIntelligenceApi.bloomCoverage().then(setBloom).catch(() => setBloom({ status: "unavailable" }));
    api.hodSubjects().then(setSubjects).catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedSubjectId) {
      hodIntelligenceApi.sectionComparison(Number(selectedSubjectId)).then(setSectionComparison).catch(() => setSectionComparison({ status: "unavailable" }));
    }
  }, [selectedSubjectId]);

  if (!outliers || !bloom) return <><Topbar greeting="Subject / Assessment Analytics" subtitle="Dashboard > Assessment Analytics" avatarLetter="H" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="Subject / Assessment Analytics" subtitle="Dashboard > Assessment Analytics" avatarLetter="H" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="grid lg:grid-cols-2 gap-6">
          <Card hover>
            <div className="flex items-start justify-between gap-3 mb-1">
              <SectionTitle title="Pass-Rate Outliers" subtitle="Subjects furthest from the department average — subjects only, never a teacher ranking" />
              {outliers.status === "available" && outliers.outliers.length > 0 && (
                <button
                  onClick={() => downloadCsv("pass_rate_outliers", Object.keys(outliers.outliers[0]), outliers.outliers.map((o: any) => Object.values(o)))}
                  className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl text-xs font-semibold text-brand bg-brand-50 hover:bg-brand-light shrink-0"
                >
                  <Download size={14} /> Export
                </button>
              )}
            </div>
            {outliers.status !== "available" ? (
              <p className="text-sm text-muted text-center py-10">{outliers.reason_unavailable || "Marks data unavailable."}</p>
            ) : outliers.outliers.length === 0 ? (
              <p className="text-sm text-muted text-center py-10">No subject differs from the department average ({outliers.department_avg_pass_rate}%) by more than 15 percentage points.</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <Badge tone="brand">Dept average: {outliers.department_avg_pass_rate}%</Badge>
                  <MetricExplain explanation={outliers.explanation} />
                </div>
                <HorizontalBarChart
                  data={outliers.outliers.map((o: any) => ({
                    label: o.subject_code, value: o.pass_rate,
                    severity: o.pass_rate >= 75 ? "green" : o.pass_rate >= 50 ? "amber" : "red",
                  }))}
                  referenceLabel="dept avg" referenceValue={outliers.department_avg_pass_rate}
                />
              </>
            )}
          </Card>

          <Card hover>
            <div className="flex items-center justify-between mb-1">
              <SectionTitle title="Bloom's Taxonomy Coverage" subtitle="Question-bank content per level — coverage, not performance" />
            </div>
            {bloom.status !== "available" ? (
              <p className="text-sm text-muted text-center py-10">{bloom.reason_unavailable || "Bloom's-level performance is not available because the current assessment data does not contain question-level marks."}</p>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <MetricExplain explanation={bloom.explanation} />
                </div>
                <StudentRadarChart data={bloom.levels.map((l: any) => ({ metric: l.level, value: l.pct, fullMark: 100 }))} />
                <p className="text-[11px] text-muted text-center mt-1">
                  {bloom.total_tagged} of {bloom.total_chunks} real question(s) have a Bloom's tag ({bloom.untagged_count} untagged, excluded above).
                </p>
              </>
            )}
          </Card>
        </div>

        <Card hover>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <SectionTitle title="Section Comparison" subtitle="Same subject, same semester — student count and pass rate per section" />
            <select
              value={selectedSubjectId} onChange={(e) => setSelectedSubjectId(e.target.value ? Number(e.target.value) : "")}
              className="border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none"
            >
              <option value="">Select a subject...</option>
              {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          {!selectedSubjectId ? (
            <p className="text-sm text-muted text-center py-8">Select a subject above to compare its sections.</p>
          ) : !sectionComparison ? (
            <p className="text-sm text-muted text-center py-8">Loading...</p>
          ) : sectionComparison.status !== "available" ? (
            <p className="text-sm text-muted text-center py-8">{sectionComparison.reason_unavailable}</p>
          ) : (
            <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
              {sectionComparison.sections.map((s: any) => (
                <div key={s.section} className="p-3.5 rounded-xl border border-gray-100">
                  <div className="text-sm font-semibold text-ink mb-1">Section {s.section}</div>
                  <div className="text-xs text-muted">{s.student_count} students</div>
                  <div className="text-xs text-muted">
                    {s.status === "available" ? <span className="font-semibold text-ink">{s.pass_rate}%</span> : "Marks unavailable"} pass rate
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card hover className="bg-gray-50/60 border-dashed">
          <p className="text-xs text-muted">
            <span className="font-semibold text-ink">Repeat-offender subjects</span> is not shown here: a student's backlog count is stored as a
            single running total with no link to which specific subject it came from anywhere in the data, so there is no real way to attribute
            backlogs to a subject without fabricating one.
          </p>
        </Card>
      </div>
    </>
  );
}
