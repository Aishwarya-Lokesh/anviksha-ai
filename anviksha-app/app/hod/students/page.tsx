"use client";

import { useEffect, useRef, useState } from "react";
import { Download, GraduationCap, Search } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Badge, Button } from "@/components/ui/Primitives";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { useUrlState } from "@/lib/useUrlState";

const STATUSES = [{ key: "", label: "All" }, { key: "active", label: "Active" }, { key: "passed_out", label: "Passed out" }];
const SELECT = "border border-gray-200 bg-white rounded-xl px-3 min-h-[44px] text-sm text-ink outline-none";

export default function HodStudentsPage() {
  // Batch, semester, status, search and page all live in the address.
  const [params, setParams] = useUrlState();
  const batch = params.get("batch") || "";
  const semester = params.get("semester") || "";
  const status = params.get("status") || "";
  const linkedQuery = params.get("q") || "";
  const page = Math.max(1, Number(params.get("page")) || 1);

  const [query, setQuery] = useState(linkedQuery);
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  const [batches, setBatches] = useState<string[]>([]);
  const [department, setDepartment] = useState("");
  const [exporting, setExporting] = useState(false);
  const requestSeq = useRef(0);
  const { push } = useToast();

  useEffect(() => {
    api.hodMe().then((d) => setDepartment(d.department)).catch(() => {});
    api.hodStudentsByBatch().then((rows) => setBatches(rows.map((r: any) => r.batch))).catch(() => {});
  }, []);

  // Typing waits a moment before it changes the address and asks the server.
  useEffect(() => {
    if (query === linkedQuery) return;
    const t = setTimeout(() => setParams({ q: query || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [query]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setQuery(linkedQuery); }, [linkedQuery]);

  const filters = () => {
    const f: Record<string, string> = {};
    if (linkedQuery) f.search = linkedQuery;
    if (status) f.status = status;
    if (batch) f.batch = batch;
    if (semester) f.semester = semester;
    return f;
  };

  const load = () => {
    const id = ++requestSeq.current;
    setFailed(false);
    api.hodStudentsFiltered({ ...filters(), page: String(page), page_size: "25" })
      .then((d) => { if (id === requestSeq.current) setData(d); })
      .catch(() => { if (id === requestSeq.current) setFailed(true); });
  };
  useEffect(load, [linkedQuery, status, batch, semester, page]); // eslint-disable-line react-hooks/exhaustive-deps

  // The export holds every student matching the filters, not only the page on screen.
  const exportAll = async () => {
    setExporting(true);
    try {
      const all = await api.hodStudentsFiltered({ ...filters(), page: "1", page_size: "5000" });
      downloadCsv(
        `students${batch ? `_batch_${batch}` : ""}${semester ? `_sem_${semester}` : ""}${status ? `_${status}` : ""}`,
        ["USN", "Name", "Batch", "Semester", "CGPA", "Backlogs", "Status"],
        all.students.map((s: any) => [s.usn, s.name, s.batch, s.semester, s.cgpa, s.backlogs, s.status]),
      );
      push(`${all.students.length} student${all.students.length === 1 ? "" : "s"} exported`);
    } catch {
      push("Could not export. Please try again.", "error");
    }
    setExporting(false);
  };

  const title = "Department Students";
  if (failed) return <><Topbar greeting={title} subtitle="Your department" avatarLetter="H" /><LoadError message="We couldn't load the students." onRetry={load} /></>;
  if (!data) return <><Topbar greeting={title} subtitle="Loading…" avatarLetter="H" /><DashboardSkeleton /></>;

  const filtered = !!(batch || semester || status || linkedQuery);

  return (
    <>
      <Topbar greeting={title} subtitle={`Dashboard > Department Students${department ? ` — ${department}` : ""}`} avatarLetter="H" />
      <div className="p-4 md:p-8 space-y-5">
        <div className="flex items-end gap-3 flex-wrap">
          <label className="text-xs text-muted">
            <span className="block mb-1">Batch</span>
            <select value={batch} onChange={(e) => setParams({ batch: e.target.value || null, page: null })} className={SELECT}>
              <option value="">All batches</option>
              {(batch && !batches.includes(batch) ? [batch, ...batches] : batches).map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">
            <span className="block mb-1">Semester</span>
            <select value={semester} onChange={(e) => setParams({ semester: e.target.value || null, page: null })} className={SELECT}>
              <option value="">All semesters</option>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>Semester {n}</option>)}
            </select>
          </label>
          <label className="text-xs text-muted">
            <span className="block mb-1">Status</span>
            <select value={status} onChange={(e) => setParams({ status: e.target.value || null, page: null })} className={SELECT}>
              {STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="relative flex-1 min-w-[13rem] max-w-sm text-xs text-muted">
            <span className="block mb-1">Search</span>
            <Search size={15} className="absolute left-3.5 bottom-[14px] text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name or USN" className={`${SELECT} w-full pl-10`} />
          </label>
          <div className="flex gap-2 ml-auto">
            {filtered && <Button variant="ghost" className="min-h-[44px]" onClick={() => { setQuery(""); setParams({ batch: null, semester: null, status: null, q: null, page: null }); }}>Clear filters</Button>}
            <Button variant="secondary" className="min-h-[44px]" disabled={exporting || data.total === 0} onClick={exportAll}><Download size={14} /> {exporting ? "Exporting…" : `Export ${data.total}`}</Button>
          </div>
        </div>

        <Card className="!p-0 overflow-hidden">
          {data.students.length === 0 ? (
            <EmptyState icon={GraduationCap} title={filtered ? "No student matches these filters" : "No students in this department yet"} hint={filtered ? "Try a different batch, semester or search." : undefined} />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[620px]">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-gray-100">
                      <th className="py-3 pl-5 pr-3 font-medium">USN</th><th className="py-3 pr-3 font-medium">Name</th>
                      <th className="py-3 pr-3 font-medium">Batch</th><th className="py-3 pr-3 font-medium">Semester</th>
                      <th className="py-3 pr-3 font-medium">CGPA</th><th className="py-3 pr-3 font-medium">Backlogs</th><th className="py-3 pr-5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((s: any) => (
                      <tr key={s.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2.5 pl-5 pr-3 text-muted whitespace-nowrap">{s.usn}</td>
                        <td className="py-2.5 pr-3 font-medium text-ink">{s.name}</td>
                        <td className="py-2.5 pr-3 text-muted numeric">{s.batch}</td>
                        <td className="py-2.5 pr-3 text-muted numeric">{s.semester ?? "—"}</td>
                        <td className="py-2.5 pr-3 text-ink numeric">{s.cgpa != null ? Number(s.cgpa).toFixed(2) : "—"}</td>
                        <td className="py-2.5 pr-3 numeric">{s.backlogs ? <Badge tone="danger">{s.backlogs}</Badge> : <span className="text-muted">0</span>}</td>
                        <td className="py-2.5 pr-5"><Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status === "passed_out" ? "Passed out" : s.status === "active" ? "Active" : s.status}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-gray-100 flex-wrap">
                <div className="text-xs text-muted">{data.total} student{data.total === 1 ? "" : "s"} · page {data.page} of {data.total_pages}</div>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" className="min-h-[44px]" disabled={page <= 1} onClick={() => setParams({ page: page > 2 ? String(page - 1) : null })}>Previous</Button>
                  <Button size="sm" variant="secondary" className="min-h-[44px]" disabled={page >= data.total_pages} onClick={() => setParams({ page: String(page + 1) })}>Next</Button>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
