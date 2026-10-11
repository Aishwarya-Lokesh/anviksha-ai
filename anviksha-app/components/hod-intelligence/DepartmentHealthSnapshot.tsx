"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { MetricExplain } from "@/components/ui/MetricExplain";
import { hodIntelligenceApi } from "@/lib/hodIntelligenceApi";
import { CalendarCheck, AlertTriangle, GraduationCap, FileText } from "lucide-react";

/**
 * Phase 3 — Department Health Snapshot. A pure rollup of already-computed
 * values (Phase 1's live attendance, the existing HOD at-risk formula, the
 * existing stored CGPA field, and one new pending-documents query). Every
 * number is clickable and opens a real detail view — no new full pages, per
 * the spec's "no new pages unless none exists" (only At-Risk and Pending
 * Documents needed a new modal; CGPA reuses the already-existing /hod/stats
 * per-semester data, attendance links straight to the existing Phase 1
 * section already on this same dashboard).
 */
export function DepartmentHealthSnapshot({ cgpaBySemester }: { cgpaBySemester?: { semester: number; avg_cgpa: number; count: number }[] }) {
  const [snapshot, setSnapshot] = useState<any>(null);
  const [openAtRisk, setOpenAtRisk] = useState(false);
  const [atRisk, setAtRisk] = useState<any>(null);
  const [openDocs, setOpenDocs] = useState(false);
  const [docs, setDocs] = useState<any>(null);
  const [openCgpa, setOpenCgpa] = useState(false);

  useEffect(() => {
    hodIntelligenceApi.healthSnapshot().then(setSnapshot).catch(() => setSnapshot({}));
  }, []);

  const openAtRiskModal = () => {
    setOpenAtRisk(true);
    if (!atRisk) hodIntelligenceApi.atRiskDetail().then(setAtRisk).catch(() => setAtRisk({ students: [] }));
  };
  const openDocsModal = () => {
    setOpenDocs(true);
    if (!docs) hodIntelligenceApi.pendingDocuments().then(setDocs).catch(() => setDocs({ requests: [] }));
  };

  if (!snapshot) return null;

  const tiles = [
    {
      key: "attendance", label: "Today's Attendance", icon: CalendarCheck, tone: "info",
      metric: snapshot.attendance_today, onClick: () => document.getElementById("live-attendance")?.scrollIntoView({ behavior: "smooth" }),
    },
    {
      key: "at_risk", label: "At-Risk Students", icon: AlertTriangle, tone: "danger",
      metric: snapshot.at_risk, onClick: openAtRiskModal,
    },
    {
      key: "cgpa", label: "Average CGPA", icon: GraduationCap, tone: "success",
      metric: snapshot.avg_cgpa, onClick: () => setOpenCgpa(true),
    },
    {
      key: "docs", label: "Pending Documents", icon: FileText, tone: "warning",
      metric: snapshot.pending_documents, onClick: openDocsModal,
    },
  ];

  const toneClasses: Record<string, string> = {
    info: "bg-info/10 text-info", danger: "bg-danger/10 text-danger",
    success: "bg-success/10 text-success", warning: "bg-warning/10 text-[#9c6b12]",
  };

  return (
    <>
      <Card hover>
        <SectionTitle title="Department Health Snapshot" subtitle="Four key numbers — select any of them for the detail behind it" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {tiles.map((t, i) => (
            <motion.button
              key={t.key}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05, duration: 0.4 }}
              onClick={t.onClick}
              className="text-left p-4 rounded-xl border border-gray-100 hover:border-gray-200 hover:shadow-card transition-all"
            >
              <div className="flex items-center justify-between mb-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${toneClasses[t.tone]}`}>
                  <t.icon size={16} />
                </div>
                {t.metric && <MetricExplain explanation={t.metric.explanation} basis={t.metric.basis} reasonUnavailable={t.metric.reason_unavailable} />}
              </div>
              <div className="text-xl font-extrabold font-display text-ink numeric">
                {t.metric ? (t.key === "attendance" && t.metric.status === "available" ? `${t.metric.value}%` : t.metric.display) : "…"}
              </div>
              <div className="text-xs text-muted mt-0.5">{t.label}</div>
              {t.metric && t.metric.status !== "available" && <Badge tone="neutral" className="mt-1.5">{t.metric.status === "pending" ? "Pending" : "Not available"}</Badge>}
            </motion.button>
          ))}
        </div>
      </Card>

      <CenterModal open={openAtRisk} onClose={() => setOpenAtRisk(false)} title="At-Risk Students">
        {!atRisk ? (
          <p className="text-sm text-muted text-center py-6">Loading...</p>
        ) : atRisk.students.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No at-risk students found for this department.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {atRisk.students.map((s: any) => (
              <div key={s.student_id} className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50">
                <div>
                  <div className="text-sm font-medium text-ink">{s.name}</div>
                  <div className="text-xs text-muted">{s.usn} · Sem {s.semester}</div>
                </div>
                <Badge tone="danger">{s.reason}</Badge>
              </div>
            ))}
          </div>
        )}
      </CenterModal>

      <CenterModal open={openDocs} onClose={() => setOpenDocs(false)} title="Pending Document Requests">
        {!docs ? (
          <p className="text-sm text-muted text-center py-6">Loading...</p>
        ) : docs.requests.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No pending document requests for this department.</p>
        ) : (
          <div className="space-y-1.5 max-h-96 overflow-y-auto">
            {docs.requests.map((r: any) => (
              <div key={r.id} className="p-2.5 rounded-lg bg-gray-50">
                <div className="text-sm font-medium text-ink">{r.type}</div>
                <div className="text-xs text-muted">{r.student_name} · {r.purpose || "no purpose given"} · requested {r.requested_date.slice(0, 10)}</div>
              </div>
            ))}
          </div>
        )}
      </CenterModal>

      <CenterModal open={openCgpa} onClose={() => setOpenCgpa(false)} title="Average CGPA by Semester">
        {!cgpaBySemester || cgpaBySemester.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No CGPA data available yet.</p>
        ) : (
          <div className="space-y-1.5">
            {cgpaBySemester.map((row) => (
              <div key={row.semester} className="flex items-center justify-between p-2.5 rounded-lg bg-gray-50">
                <span className="text-sm text-ink">Semester {row.semester}</span>
                <span className="text-sm font-semibold text-ink">{row.avg_cgpa} <span className="text-xs text-muted font-normal">({row.count} students)</span></span>
              </div>
            ))}
          </div>
        )}
      </CenterModal>
    </>
  );
}
