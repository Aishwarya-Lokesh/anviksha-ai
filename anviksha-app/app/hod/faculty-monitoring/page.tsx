"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { PillNav } from "@/components/ui/Tabs";
import { MetricExplain } from "@/components/ui/MetricExplain";
import { hodIntelligenceApi } from "@/lib/hodIntelligenceApi";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { Users, BookOpen, ClipboardList, AlertTriangle, Search, Bell, Sparkles, Download } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { useUrlState } from "@/lib/useUrlState";

/**
 * Phase 2 — Faculty Monitoring & Faculty Alerts. New page, new nav item
 * (app/hod/layout.tsx), reachable only by an authenticated HOD, scoped to
 * their own department by the backend. Nothing here computes or displays a
 * faculty score/ranking (Part A5): the table's default sort is by name, and
 * no numeric "performance" column exists anywhere.
 */
export default function FacultyMonitoringPage() {
  const [urlParams, setUrlParams] = useUrlState();
  const tab: "activity" | "alerts" = urlParams.get("tab") === "alerts" ? "alerts" : "activity";
  const setTab = (t: "activity" | "alerts") => setUrlParams({ tab: t === "alerts" ? "alerts" : null });
  const [overview, setOverview] = useState<any>(null);
  const [facultyRows, setFacultyRows] = useState<any[] | null>(null);
  const [search, setSearch] = useState(urlParams.get("q") || "");
  const [alerts, setAlerts] = useState<any[] | null>(null);
  const [selectedFacultyId, setSelectedFacultyId] = useState<number | null>(null);
  const [detail, setDetail] = useState<any>(null);
  const [facultyBriefing, setFacultyBriefing] = useState<any>(null);

  useEffect(() => {
    hodIntelligenceApi.facultyOverview().then(setOverview).catch(() => setOverview({}));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      hodIntelligenceApi.facultyTable(search || undefined).then((d) => setFacultyRows(d.faculty)).catch(() => setFacultyRows([]));
      if ((urlParams.get("q") || "") !== search) setUrlParams({ q: search || null });
    }, 250);
    return () => window.clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (tab === "alerts" && !alerts) {
      hodIntelligenceApi.alerts().then((d) => setAlerts(d.alerts)).catch(() => setAlerts([]));
    }
  }, [tab, alerts]);

  useEffect(() => {
    if (selectedFacultyId != null) {
      hodIntelligenceApi.facultyDetail(selectedFacultyId).then(setDetail).catch(() => setDetail(null));
      hodIntelligenceApi.facultyBriefing(selectedFacultyId).then(setFacultyBriefing).catch(() => setFacultyBriefing(null));
    } else {
      setDetail(null);
      setFacultyBriefing(null);
    }
  }, [selectedFacultyId]);

  if (!overview) return <><Topbar greeting="Faculty Monitoring" subtitle="Dashboard > Faculty Monitoring" avatarLetter="H" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="Faculty Monitoring" subtitle="Dashboard > Faculty Monitoring" avatarLetter="H" />
      <div className="p-4 md:p-8 space-y-6">
        <p className="text-xs text-muted -mt-2">
          Objective, real teaching activity only — there is no faculty score or ranking here.
        </p>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Faculty" value={overview.total_faculty} icon={Users} tone="brand" />
          <StatCard label="Subjects Being Taught" value={overview.subjects_being_taught} icon={BookOpen} tone="info" delay={0.05} />
          <StatCard label="Sessions Recorded" value={overview.sessions_recorded} icon={ClipboardList} tone="success" delay={0.1} />
          <StatCard label="Open Alerts" value={(overview.pending_attendance_alerts || 0) + (overview.pending_marks_alerts || 0)} icon={AlertTriangle} tone="warning" delay={0.15} />
        </div>

        <PillNav
          items={[{ key: "activity", label: "Teaching Activity" }, { key: "alerts", label: `Faculty Alerts${alerts ? ` (${alerts.length})` : ""}` }]}
          active={tab}
          onChange={(v) => setTab(v as "activity" | "alerts")}
        />

        {tab === "activity" && (
          <Card hover className="!p-0 overflow-hidden">
            <div className="p-5 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <SectionTitle title="Faculty" subtitle="Teaching activity per faculty member — default sorted by name" />
              <button
                disabled={!facultyRows || facultyRows.length === 0}
                onClick={() => downloadCsv("faculty_teaching_activity", ["Name", "Assigned subjects", "Sessions recorded", "Attendance last updated", "Marks status", "At-risk students", "Open alerts", "Status"],
                  (facultyRows || []).map((f) => [f.name, f.assigned_subjects.join("; "), f.sessions_recorded, f.attendance_last_updated || "Pending", f.marks_status, f.at_risk_students, f.open_alert_count, f.status === "up_to_date" ? "Up to date" : "Pending"]))}
                className="inline-flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl text-xs font-semibold text-brand bg-brand-50 hover:bg-brand-light disabled:opacity-50 shrink-0 ml-auto"
              >
                <Download size={14} /> Export
              </button>
              <div className="relative w-64 max-w-full shrink-0">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, ID, or subject..."
                  className="w-full border border-gray-200 rounded-xl pl-8 pr-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
                />
              </div>
            </div>
            {!facultyRows ? (
              <div className="p-4 md:p-8 text-sm text-muted text-center">Loading...</div>
            ) : facultyRows.length === 0 ? (
              <p className="text-sm text-muted text-center py-10">No faculty data available.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted border-b border-gray-100 bg-gray-50/60">
                      <th className="py-2.5 px-5 font-medium">Name</th>
                      <th className="py-2.5 px-3 font-medium">Assigned Subjects</th>
                      <th className="py-2.5 px-3 font-medium text-right">Sessions Recorded</th>
                      <th className="py-2.5 px-3 font-medium">Attendance Last Updated</th>
                      <th className="py-2.5 px-3 font-medium">Marks Status</th>
                      <th className="py-2.5 px-3 font-medium text-right">At-Risk</th>
                      <th className="py-2.5 px-3 font-medium text-right">Open Alerts</th>
                      <th className="py-2.5 px-5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {facultyRows.map((f) => (
                      <tr key={f.faculty_id} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors" onClick={() => setSelectedFacultyId(f.faculty_id)}>
                        <td className="py-2.5 px-5 font-medium text-ink">{f.name}</td>
                        <td className="py-2.5 px-3 text-muted">{f.assigned_subjects.length > 0 ? f.assigned_subjects.join(", ") : "—"}</td>
                        <td className="py-2.5 px-3 text-right">{f.sessions_recorded}</td>
                        <td className="py-2.5 px-3 text-muted">{f.attendance_last_updated || "Pending"}</td>
                        <td className="py-2.5 px-3">
                          {f.marks_status === "available" && <Badge tone="success">Available</Badge>}
                          {f.marks_status === "pending" && <Badge tone="warning">Pending</Badge>}
                          {f.marks_status === "unavailable" && <Badge tone="neutral">Not available</Badge>}
                        </td>
                        <td className="py-2.5 px-3 text-right">{f.at_risk_students}</td>
                        <td className="py-2.5 px-3 text-right">{f.open_alert_count}</td>
                        <td className="py-2.5 px-5">
                          <Badge tone={f.status === "up_to_date" ? "success" : "warning"}>{f.status === "up_to_date" ? "Up to Date" : "Pending"}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-muted px-5 py-3 border-t border-gray-100 bg-gray-50/40">
              "Attention Required" is not used here — it would require a real deadline the data doesn't have (no timetable/due-date is stored anywhere yet).
              Every faculty member is either "Up to Date" (no open items) or "Pending" (at least one).
            </p>
          </Card>
        )}

        {tab === "alerts" && (
          <Card hover>
            <SectionTitle title="Faculty Alerts" subtitle="Every open, DB-grounded item across the department" />
            {!alerts ? (
              <div className="p-4 md:p-8 text-sm text-muted text-center">Loading...</div>
            ) : alerts.length === 0 ? (
              <div className="text-center py-10">
                <Bell size={22} className="text-muted mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted">No open alerts right now.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {alerts.map((a, i) => (
                  <div key={i} className="flex items-start justify-between gap-3 p-3.5 rounded-xl bg-gray-50 hover:bg-gray-100/70 transition-colors cursor-pointer" onClick={() => setSelectedFacultyId(a.faculty_id)}>
                    <div className="flex items-start gap-3">
                      <Badge tone={a.type === "missing_attendance" ? "warning" : "info"}>{a.type === "missing_attendance" ? "Attendance" : "Marks"}</Badge>
                      <div>
                        <div className="text-sm font-medium text-ink">{a.message}</div>
                        <div className="text-xs text-muted mt-0.5">{a.faculty_name}</div>
                      </div>
                    </div>
                    <MetricExplain explanation={a.explanation} basis={a.basis} />
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <CenterModal open={selectedFacultyId != null} onClose={() => setSelectedFacultyId(null)} title={detail?.name || "Faculty Detail"} width="max-w-2xl">
        {!detail ? (
          <p className="text-sm text-muted text-center py-8">Loading...</p>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge tone="brand">{detail.designation || "Faculty"}</Badge>
              {detail.vtu_teacher_id && <Badge tone="neutral">{detail.vtu_teacher_id}</Badge>}
              <Badge tone={detail.status === "up_to_date" ? "success" : "warning"}>{detail.status === "up_to_date" ? "Up to Date" : "Pending"}</Badge>
            </div>

            {facultyBriefing?.briefing && (
              <div className="p-3 rounded-xl bg-brand-light flex gap-2">
                <Sparkles size={14} className="text-brand shrink-0 mt-0.5" />
                <p className="text-xs text-ink leading-relaxed">{facultyBriefing.briefing}</p>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold text-muted mb-2">Teaching activity by subject</div>
              {detail.subjects.length === 0 ? (
                <p className="text-sm text-muted text-center py-6">No teaching assignments configured for this faculty member yet.</p>
              ) : (
                <div className="space-y-2">
                  {detail.subjects.map((s: any) => (
                    <div key={s.subject_id} className="p-3 rounded-xl border border-gray-100">
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="text-sm font-medium text-ink">{s.subject_code} — {s.subject_name}</div>
                        <Badge tone="neutral">Sem {s.semester}{s.section ? `-${s.section}` : ""}</Badge>
                      </div>
                      <div className="grid grid-cols-4 gap-2 text-xs text-muted">
                        <div><span className="font-semibold text-ink">{s.student_count}</span> students</div>
                        <div><span className="font-semibold text-ink">{s.sessions_recorded}</span> sessions</div>
                        <div>
                          {s.attendance_status === "available" ? <span className="font-semibold text-ink">{s.avg_attendance_pct}%</span> : "N/A"} attendance
                        </div>
                        <div>
                          {s.marks_status === "available" ? <span className="font-semibold text-ink">{s.avg_internal_marks}</span> : "N/A"} avg marks
                        </div>
                      </div>
                      {s.at_risk_count > 0 && <div className="text-xs text-danger mt-1.5">{s.at_risk_count} at-risk student(s)</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {detail.alerts.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-muted mb-2">Open alerts</div>
                <div className="space-y-1.5">
                  {detail.alerts.map((a: any, i: number) => (
                    <div key={i} className="text-xs text-ink bg-warning/10 rounded-lg p-2.5">{a.message}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </CenterModal>
    </>
  );
}
