"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { Search, Upload, Download } from "lucide-react";
import studentsRawMock from "@/data/students.json";
import { api } from "@/lib/api";
import { downloadExcel } from "@/lib/fileGen";
import * as XLSX from "xlsx";

export default function StudentDatasetPage() {
  const [query, setQuery] = useState("");
  const [batch, setBatch] = useState("All");
  const { push } = useToast();
  const [students, setStudents] = useState<any[]>(studentsRawMock);
  const [liveMode, setLiveMode] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.adminStudents()
      .then((rows) => { setStudents(rows); setLiveMode(true); })
      .catch(() => setLiveMode(false));
  }, []);

  const batches = useMemo(() => ["All", ...Array.from(new Set(students.map((s: any) => s.batch)))], [students]);

  const filtered = useMemo(() => students.filter((s: any) =>
    ((s.name || "").toLowerCase().includes(query.toLowerCase()) || (s.usn || "").toLowerCase().includes(query.toLowerCase())) &&
    (batch === "All" || s.batch === batch)
  ), [query, batch, students]);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet) as any[];
    // Real parse — appended to the current view. Persisting each row to the backend
    // individually via /admin/students is the next step once column mapping per your
    // real Excel format is confirmed (same validated-import pattern as the CGPA import).
    setStudents((prev) => [...rows.map((r, i) => ({
      id: `imported-${Date.now()}-${i}`,
      usn: r.USN || r.usn || "N/A",
      name: r.Name || r.name || "Unnamed",
      batch: String(r.Batch || r.batch || "Unknown"),
      cgpa: Number(r.CGPA || r.cgpa) || null,
      backlogs: Number(r.Backlogs || r.backlogs) || 0,
      data_status: "provisional",
    })), ...prev]);
    push(`Parsed ${rows.length} rows from ${file.name} — added to this view (provisional, not yet saved to backend)`, "info");
    e.target.value = "";
  };

  return (
    <>
      <Topbar greeting="Student Dataset" subtitle="Dashboard > Student Dataset" avatarLetter="A" />
      <div className="px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Live data from backend" : "○ Mock data (backend not connected)"}
        </span>
      </div>
      <div className="p-8 space-y-6">
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
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFileChange} />
              <Button variant="secondary" onClick={handleImportClick}><Upload size={15} /> Import Excel</Button>
              <Button variant="secondary" onClick={() => downloadExcel(
                filtered.map((s: any) => ({ USN: s.usn, Name: s.name, Batch: s.batch, CGPA: s.cgpa, Backlogs: s.backlogs, Status: s.status })),
                "Student_Dataset_Export", "Students"
              )}><Download size={15} /> Export</Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
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
          <div className="text-xs text-muted mt-3">Showing {filtered.length} of {students.length} students</div>
        </Card>
      </div>
    </>
  );
}
