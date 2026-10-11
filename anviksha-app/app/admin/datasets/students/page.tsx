"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { Search, Upload, Download } from "lucide-react";
import { LoadError, EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api";
import { downloadExcel } from "@/lib/fileGen";
import * as XLSX from "xlsx";

export default function StudentDatasetPage() {
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("All");
  const { push } = useToast();
  const [students, setStudents] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoadError(false);
    api.adminStudents().then((rows) => { setStudents(rows); setLoaded(true); }).catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const batches = useMemo(() => ["All", ...Array.from(new Set(students.map((s: any) => s.batch)))], [students]);

  const filtered = useMemo(() => students.filter((s: any) =>
    ((s.name || "").toLowerCase().includes(query.toLowerCase()) || (s.usn || "").toLowerCase().includes(query.toLowerCase())) &&
    (batch === "All" || s.batch === batch)
  ), [query, batch, students]);


  return (
    <>
      <Topbar greeting="Student Dataset" subtitle="Dashboard > Student Dataset" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search students..." className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl outline-none w-64" />
              </div>
              <select value={batch} onChange={(e) => setBatch(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                {batches.map((b) => <option key={b}>{b}</option>)}
              </select>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => downloadExcel(
                filtered.map((s: any) => ({ USN: s.usn, Name: s.name, Batch: s.batch, CGPA: s.cgpa, Backlogs: s.backlogs, Status: s.status })),
                "Student_Dataset_Export", "Students"
              )}><Download size={15} /> Export</Button>
            </div>
          </div>
          {loadError ? <LoadError message="We couldn't load the student list." onRetry={load} /> : !loaded ? (
            <p className="text-sm text-muted text-center py-10">Loading students…</p>
          ) : filtered.length === 0 ? (
            <EmptyState title={query || batch !== "All" ? "No students match these filters" : "No students on record yet"} />
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-muted border-b border-gray-100">
                  <th className="py-2.5 font-medium">USN</th><th className="py-2.5 font-medium">Name</th>
                  <th className="py-2.5 font-medium">Batch</th><th className="py-2.5 font-medium">CGPA</th><th className="py-2.5 font-medium">Backlogs</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s: any) => (
                  <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                    <td className="py-3 text-muted">{s.usn}</td>
                    <td className="py-3 font-medium text-ink">{s.name}</td>
                    <td className="py-3 text-muted">{s.batch}</td>
                    <td className="py-3 numeric">{s.cgpa != null ? Number(s.cgpa).toFixed(2) : "N/A"}</td>
                    <td className="py-3">{s.backlogs > 0 ? <Badge tone="danger">{s.backlogs}</Badge> : <Badge tone="success">0</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          <div className="text-xs text-muted mt-3">Showing {filtered.length} of {students.length} students</div>
        </Card>
      </div>
    </>
  );
}
