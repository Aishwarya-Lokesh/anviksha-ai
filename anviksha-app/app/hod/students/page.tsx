"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Badge, Button } from "@/components/ui/Primitives";
import { PillNav } from "@/components/ui/Tabs";
import { Search, Inbox } from "lucide-react";
import { api } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

export default function HodStudentsPage() {
  const [data, setData] = useState<any>(null);
  const [query, setQuery] = useState("");
  // Arriving from search: start with that student already filtered.
  const linkedQuery = useSearchParams().get("q");
  useEffect(() => { if (linkedQuery) setQuery(linkedQuery); }, [linkedQuery]);
  const [status, setStatus] = useState("all");
  const [batch, setBatch] = useState("");
  const [batches, setBatches] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [department, setDepartment] = useState("");
  const requestSeq = useRef(0);

  useEffect(() => {
    api.hodMe().then((d) => setDepartment(d.department)).catch(() => {});
    api.hodStudentsByBatch().then((rows) => setBatches(rows.map((r: any) => r.batch))).catch(() => {});
  }, []);

  useEffect(() => {
    const id = ++requestSeq.current;
    const timer = setTimeout(() => {
      const params: Record<string, string> = { page: String(page), page_size: "25" };
      if (query) params.search = query;
      if (status !== "all") params.status = status;
      if (batch) params.batch = batch;
      api.hodStudentsFiltered(params)
        .then((d) => { if (id === requestSeq.current) setData(d); })
        .catch(() => { if (id === requestSeq.current) setData({ students: [], total: 0 }); });
    }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [query, status, batch, page]);

  if (!data) return <><Topbar greeting="Department Students" subtitle="Loading..." avatarLetter="H" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="Department Students" subtitle="Dashboard > Department Students" avatarLetter="H" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <label className="text-[10px] text-muted block mb-1">Department</label>
                <div className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-gray-50 w-48">{department || "..."}</div>
              </div>
              <div>
                <label className="text-[10px] text-muted block mb-1">Batch</label>
                <select value={batch} onChange={(e) => { setBatch(e.target.value); setPage(1); }} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                  <option value="">All Batches</option>
                  {batches.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] text-muted block mb-1">Search</label>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                  <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }} placeholder="Search by name or USN..." className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl outline-none w-56" />
                </div>
              </div>
            </div>
            <PillNav items={[{ key: "all", label: "All" }, { key: "active", label: "Active" }, { key: "passed_out", label: "Passed Out" }]} active={status} onChange={(v) => { setStatus(v); setPage(1); }} />
          </div>

          {data.students.length === 0 ? (
            <div className="text-center py-10">
              <Inbox size={28} className="text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted">{data.empty_message || "No students found."}</p>
            </div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted border-b border-gray-100">
                    <th className="py-2.5 font-medium">USN</th><th className="py-2.5 font-medium">Name</th>
                    <th className="py-2.5 font-medium">Semester</th><th className="py-2.5 font-medium">Batch</th>
                    <th className="py-2.5 font-medium">CGPA</th><th className="py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.students.map((s: any) => (
                    <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                      <td className="py-3 text-muted">{s.usn}</td>
                      <td className="py-3 font-medium text-ink">{s.name}</td>
                      <td className="py-3 text-muted">{s.semester}</td>
                      <td className="py-3 text-muted">{s.batch}</td>
                      <td className="py-3 numeric">{s.cgpa?.toFixed(2) ?? "N/A"}</td>
                      <td className="py-3"><Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="flex items-center justify-between mt-4">
                <div className="text-xs text-muted">Showing {data.students.length} of {data.total} students — page {data.page} of {data.total_pages}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Button>
                  <Button size="sm" variant="secondary" onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}>Next</Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
