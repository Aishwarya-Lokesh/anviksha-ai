"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { MetricExplain } from "@/components/ui/MetricExplain";
import { TrendLineChart } from "@/components/charts/Charts";
import { AttendanceHeatmap } from "@/components/charts/hod-intelligence/AttendanceHeatmap";
import { SEVERITY_BADGE_TONE } from "@/components/charts/hod-intelligence/severity";
import { useLiveRefresh, useAgoLabel } from "@/hooks/useLiveRefresh";
import { hodIntelligenceApi } from "@/lib/hodIntelligenceApi";
import { RefreshCw } from "lucide-react";

/**
 * Phase 1 — Live Daily Attendance. Additive section on the existing HOD
 * dashboard (no existing card/section is touched). Polls its own data every
 * 45s, refetches on window focus, pauses while the tab is hidden, and shows
 * a "Last updated Xs ago" indicator — the one shared refresh strategy
 * (Part D5), reused for both the "today" and "trend" calls here.
 */
export function LiveAttendanceSection() {
  const today = useLiveRefresh(() => hodIntelligenceApi.attendanceToday(), 45000);
  const trend = useLiveRefresh(() => hodIntelligenceApi.attendanceTrend(14), 45000);
  const agoLabel = useAgoLabel(today.lastUpdated);
  const [tab, setTab] = useState<"table" | "heatmap">("table");

  return (
    <Card hover id="live-attendance">
      <div className="flex items-center justify-between mb-1">
        <SectionTitle title="Live Daily Attendance" subtitle="Real, department-scoped — today's submitted sessions only" />
        <div className="flex items-center gap-2 text-[11px] text-muted shrink-0">
          {today.loading && !today.data ? "Loading…" : agoLabel}
          <button onClick={() => { today.refresh(); trend.refresh(); }} className="p-1.5 rounded-lg hover:bg-gray-100 text-muted hover:text-brand transition-colors" aria-label="Refresh now">
            <RefreshCw size={13} className={today.loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {today.error && !today.data ? (
        <p className="text-sm text-danger text-center py-8">Could not load attendance data — check backend connection.</p>
      ) : !today.data ? (
        <div className="animate-pulse h-24 bg-gray-50 rounded-xl" />
      ) : (
        <>
          {/* Headline */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} className="flex items-center gap-3 py-3">
            <div className="text-3xl font-extrabold font-display text-ink numeric">
              {today.data.headline.display}
            </div>
            <Badge tone={today.data.headline.status === "available" ? SEVERITY_BADGE_TONE[today.data.headline.value >= 75 ? "green" : today.data.headline.value >= 50 ? "amber" : "red"] : "neutral"}>
              {today.data.headline.status === "available" ? "Today" : "No submissions yet today"}
            </Badge>
            <MetricExplain
              explanation={today.data.headline.explanation}
              basis={today.data.headline.basis}
              reasonUnavailable={today.data.headline.reason_unavailable}
            />
          </motion.div>

          {/* Trend */}
          <div className="mb-5">
            <div className="text-xs font-semibold text-muted mb-2">14-day department attendance trend</div>
            {trend.data && trend.data.points.some((p: any) => p.status === "available") ? (
              <TrendLineChart
                data={trend.data.points.map((p: any) => ({ label: p.date.slice(5), pct: p.pct }))}
                lines={[{ key: "pct", color: "#5B3FD9" }]}
              />
            ) : (
              <p className="text-xs text-muted text-center py-6">
                No attendance has been submitted on any of the last 14 days for this department yet.
              </p>
            )}
          </div>

          {/* Table / Heatmap toggle */}
          <div className="flex items-center gap-2 mb-3">
            <button onClick={() => setTab("table")} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${tab === "table" ? "bg-brand-light text-brand" : "text-muted hover:bg-gray-50"}`}>
              Breakdown
            </button>
            <button onClick={() => setTab("heatmap")} className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${tab === "heatmap" ? "bg-brand-light text-brand" : "text-muted hover:bg-gray-50"}`}>
              Heatmap
            </button>
          </div>

          {today.data.breakdown.length === 0 ? (
            <p className="text-sm text-muted text-center py-8">No attendance records available.</p>
          ) : tab === "table" ? (
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-left text-muted border-b border-gray-100">
                    <th className="py-2 font-medium">Sem</th>
                    <th className="py-2 font-medium">Section</th>
                    <th className="py-2 font-medium">Subject</th>
                    <th className="py-2 font-medium text-right">Present</th>
                    <th className="py-2 font-medium text-right">Absent</th>
                    <th className="py-2 font-medium text-right">Total</th>
                    <th className="py-2 font-medium text-right">%</th>
                  </tr>
                </thead>
                <tbody>
                  {today.data.breakdown.map((row: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="py-2 text-muted">{row.semester}</td>
                      <td className="py-2 text-muted">{row.section || "All"}</td>
                      <td className="py-2 font-medium text-ink">{row.subject_code} — {row.subject_name}</td>
                      <td className="py-2 text-right">{row.present ?? "—"}</td>
                      <td className="py-2 text-right">{row.absent ?? "—"}</td>
                      <td className="py-2 text-right">{row.total ?? "—"}</td>
                      <td className="py-2 text-right">
                        {row.status === "available" ? <Badge tone={SEVERITY_BADGE_TONE[row.severity]}>{row.display}</Badge> : <Badge tone="neutral">Pending</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <AttendanceHeatmap sections={today.data.heatmap.sections} rows={today.data.heatmap.rows} />
          )}
        </>
      )}
    </Card>
  );
}
