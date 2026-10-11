"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { Drawer } from "@/components/ui/Modal";
import { Search, Eye } from "lucide-react";
import { TrendLineChart } from "@/components/charts/Charts";
import { api } from "@/lib/api";
import { downloadExcel } from "@/lib/fileGen";

export default function MyStudentsPage() {
  const [query, setQuery] = useState("");
  // Arriving from search: start with that student already filtered.
  const linkedQuery = useSearchParams().get("q");
  useEffect(() => { if (linkedQuery) setQuery(linkedQuery); }, [linkedQuery]);
  const [batch, setBatch] = useState<string>("");
  const [semester, setSemester] = useState<number | "">("");
  const [section, setSection] = useState<string>("");
  const [batches, setBatches] = useState<string[]>([]);
  const [semesters, setSemesters] = useState<number[]>([]);
  const [sections, setSections] = useState<string[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [liveMode, setLiveMode] = useState(false);

  useEffect(() => {
    api.teacherMyBatches().then((b) => { setBatches(b); setLiveMode(true); }).catch(() => setLiveMode(false));
  }, []);

  useEffect(() => {
    api.teacherAvailableSemesters(batch || undefined).then(setSemesters).catch(() => {});
  }, [batch]);

  useEffect(() => {
    api.teacherAvailableSections(batch || undefined, semester ? Number(semester) : undefined).then(setSections).catch(() => {});
  }, [batch, semester]);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (batch) params.batch = batch;
    if (semester) params.semester = String(semester);
    if (section) params.section = section;
    api.teacherStudents(params).then(setStudents).catch(() => setStudents([]));
  }, [batch, semester, section]);

  const filtered = useMemo(() => {
    return students.filter((s: any) =>
      (s.name || "").toLowerCase().includes(query.toLowerCase()) || (s.usn || "").toLowerCase().includes(query.toLowerCase())
    );
  }, [students, query]);

  return (
    <>
      <Topbar greeting="My Students" subtitle="Dashboard > My Students" avatarLetter="T" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
            <div className="flex items-center flex-wrap gap-3 min-w-0">
              <div className="relative w-full sm:w-64">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name or USN..." className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-brand/30 w-full" />
              </div>
              <select value={batch} onChange={(e) => setBatch(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                <option value="">All active batches</option>
                {batches.map((b) => <option key={b} value={b}>{b} Batch</option>)}
              </select>
              <select value={semester} onChange={(e) => setSemester(e.target.value ? Number(e.target.value) : "")} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                <option value="">All my semesters</option>
                {semesters.map((s) => <option key={s} value={s}>Sem {s}</option>)}
              </select>
              <select value={section} onChange={(e) => setSection(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                <option value="">All sections</option>
                {sections.map((s) => <option key={s} value={s}>Section {s}</option>)}
              </select>
            </div>
            <Button variant="secondary" onClick={() => downloadExcel(
              filtered.map((s: any) => ({ Name: s.name, USN: s.usn, Semester: s.semester, Section: s.section, CGPA: s.cgpa, Attendance: s.attendance_pct ?? "N/A", Backlogs: s.backlogs })),
              "My_Students_Export", "Students"
            )}>Export</Button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-gray-100">
                  <th className="py-2.5 font-medium">Student</th>
                  <th className="py-2.5 font-medium">USN</th>
                  <th className="py-2.5 font-medium">Semester</th>
                  <th className="py-2.5 font-medium">CGPA</th>
                  <th className="py-2.5 font-medium">Attendance</th>
                  <th className="py-2.5 font-medium">Backlogs</th>
                  <th className="py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s: any) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                    <td className="py-3 font-medium text-ink">{s.name}</td>
                    <td className="py-3 text-muted">{s.usn}</td>
                    <td className="py-3 text-muted">{s.semester}</td>
                    <td className="py-3 font-semibold text-ink numeric">{s.cgpa?.toFixed(2) ?? "N/A"}</td>
                    <td className="py-3">{s.attendance_pct != null ? <Badge tone={s.attendance_pct >= 85 ? "success" : s.attendance_pct >= 75 ? "info" : "danger"}>{s.attendance_pct}%</Badge> : <Badge tone="neutral">N/A</Badge>}</td>
                    <td className="py-3 text-muted">{s.backlogs}</td>
                    <td className="py-3">
                      <button onClick={() => setSelected(s)} className="p-1.5 rounded-lg hover:bg-brand-light text-brand"><Eye size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-muted mt-3">Showing {filtered.length} of your students</div>
        </Card>
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name || ""}>
        {selected && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><div className="text-muted text-xs">USN</div><div className="font-medium">{selected.usn}</div></div>
              <div><div className="text-muted text-xs">Semester</div><div className="font-medium">{selected.semester}</div></div>
              <div><div className="text-muted text-xs">CGPA</div><div className="font-medium">{selected.cgpa ?? "N/A"}</div></div>
              <div><div className="text-muted text-xs">Backlogs</div><div className="font-medium">{selected.backlogs}</div></div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}
