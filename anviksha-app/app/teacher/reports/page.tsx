"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { PillNav } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toaster";
import { Download, FileBarChart, Inbox } from "lucide-react";
import { api } from "@/lib/api";
import { downloadExcel } from "@/lib/fileGen";

export default function ReportsPage() {
  const [tab, setTab] = useState("performance");
  const [batch, setBatch] = useState("2024");
  const [performanceRows, setPerformanceRows] = useState<any[]>([]);
  const [attendanceRows, setAttendanceRows] = useState<any[]>([]);
  const [attendanceSemester, setAttendanceSemester] = useState("");
  const [attendanceDate, setAttendanceDate] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    api.teacherPerformanceReport(batch).then((rows) => { setPerformanceRows(rows); setLiveMode(true); }).catch(() => setLiveMode(false));
  }, [batch]);

  useEffect(() => {
    api.teacherAttendanceReport({ semester: attendanceSemester || undefined, date: attendanceDate || undefined })
      .then((rows) => setAttendanceRows(rows))
      .catch(() => {});
  }, [attendanceSemester, attendanceDate]);

  return (
    <>
      <Topbar greeting="Reports" subtitle="Dashboard > Reports" avatarLetter="R" />
      <div className="px-4 md:px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Real, exportable reports from actual data" : "○ Backend not connected"}
        </span>
      </div>
      <div className="p-4 md:p-8 space-y-6">
        <PillNav items={[{ key: "performance", label: "Performance Report" }, { key: "attendance", label: "Attendance Report" }]} active={tab} onChange={setTab} />

        {tab === "performance" && (
          <Card hover>
            <div className="flex items-center justify-between mb-4">
              <SectionTitle title="Performance Report" subtitle={`Real CGPA/Backlog data — Batch ${batch}`} />
              <div className="flex gap-2 items-center">
                <select value={batch} onChange={(e) => setBatch(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                  <option>2022</option><option>2023</option><option>2024</option>
                </select>
                <Button onClick={() => { downloadExcel(performanceRows, `Performance_Report_Batch_${batch}`, "Performance"); push("Real performance report downloaded"); }}>
                  <Download size={15} /> Export Excel
                </Button>
              </div>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-gray-100 sticky top-0 bg-white">
                    <th className="py-2 font-medium">USN</th><th className="py-2 font-medium">Name</th>
                    <th className="py-2 font-medium">CGPA</th><th className="py-2 font-medium">Backlogs</th><th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {performanceRows.map((r: any) => (
                    <tr key={r.USN} className="border-b border-gray-50">
                      <td className="py-2 text-muted">{r.USN}</td>
                      <td className="py-2 font-medium text-ink">{r.Name}</td>
                      <td className="py-2 numeric">{r.CGPA?.toFixed(2) ?? "N/A"}</td>
                      <td className="py-2">{r.Backlogs > 0 ? <Badge tone="danger">{r.Backlogs}</Badge> : <Badge tone="success">0</Badge>}</td>
                      <td className="py-2 text-muted">{r.Status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {tab === "attendance" && (
          <Card hover>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <SectionTitle title="Attendance Sessions Report" subtitle="Every session you've actually marked — filter by semester and/or date, or leave both blank to see everything" />
              {attendanceRows.length > 0 && (
                <Button onClick={() => { downloadExcel(attendanceRows.map((r: any) => ({ Date: r.date, "Subject Code": r.subject_code ?? "—", Sem: r.semester ?? "—", Present: r.present, Total: r.total })), "Attendance_Sessions_Report", "Attendance"); push("Attendance report downloaded"); }}>
                  <Download size={15} /> Export Excel
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-end gap-3 mb-4 p-3 bg-gray-50 rounded-xl">
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Semester</label>
                <select value={attendanceSemester} onChange={(e) => setAttendanceSemester(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none w-36">
                  <option value="">All semesters</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>Sem {s}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Date (optional)</label>
                <input type="date" value={attendanceDate} onChange={(e) => setAttendanceDate(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none" />
              </div>
              {(attendanceSemester || attendanceDate) && (
                <button onClick={() => { setAttendanceSemester(""); setAttendanceDate(""); }} className="text-xs font-semibold text-brand hover:underline pb-2.5">
                  Clear filters
                </button>
              )}
            </div>
            {attendanceRows.length === 0 ? (
              <div className="text-center py-10">
                <Inbox size={28} className="text-muted mx-auto mb-2 opacity-50" />
                <p className="text-sm text-muted">
                  {attendanceSemester || attendanceDate
                    ? "No attendance sessions match these filters."
                    : "No attendance sessions recorded yet. Mark attendance via Attendance Upload and it'll appear here."}
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-gray-100">
                    <th className="py-2 font-medium">Date</th><th className="py-2 font-medium">Subject Code</th>
                    <th className="py-2 font-medium">Sem</th>
                    <th className="py-2 font-medium">Present</th><th className="py-2 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {attendanceRows.map((r: any) => (
                    <tr key={r.session_id} className="border-b border-gray-50">
                      <td className="py-2 text-ink">{r.date}</td>
                      <td className="py-2 text-muted">{r.subject_code ?? "—"}</td>
                      <td className="py-2 text-muted">{r.semester ?? "—"}</td>
                      <td className="py-2 numeric">{r.present}</td>
                      <td className="py-2 numeric">{r.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
