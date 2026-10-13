"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";

type ReportRow = { row: number; usn: string; name: string; batch: string; ok: boolean; problems: string[] };
type Result = {
  department: string; rows: number; valid: number; invalid: number; applied: boolean; created: number;
  logins: { usn: string; email: string; temporary_password: string }[]; report: ReportRow[];
};

export default function BulkImportPage() {
  const { push } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [departmentId, setDepartmentId] = useState("");
  const [createLogins, setCreateLogins] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Result | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);

  useEffect(() => {
    api.adminDepartments().then((d: { id: number; name: string }[]) => { setDepartments(d); if (d.length) setDepartmentId(String(d[0].id)); }).catch(() => {});
  }, []);

  const choose = (f: File | null) => {
    setFile(f);
    setPreview(null);
    setDone(null);
  };

  const check = async () => {
    if (!file || busy) return;
    setBusy(true);
    try {
      setPreview(await api.adminImportStudents(file, { apply: false, createLogins, departmentId }));
      setDone(null);
    } catch (e: any) {
      push(e?.detail || "That file could not be read.", "error");
    }
    setBusy(false);
  };

  const apply = async () => {
    if (!file || busy) return;
    setConfirming(false);
    setBusy(true);
    try {
      const res: Result = await api.adminImportStudents(file, { apply: true, createLogins, departmentId });
      setDone(res);
      setPreview(null);
      push(`${res.created} student${res.created === 1 ? "" : "s"} added.`);
    } catch (e: any) {
      push(e?.detail || "The import failed. Nothing was added.", "error");
    }
    setBusy(false);
  };

  const template = () => downloadCsv("students_template", ["USN", "Name", "Batch", "Semester", "Section", "CGPA"], [["4GW25IS001", "Student Name", "2025", "1", "A", ""]]);
  const errorReport = (r: Result) => downloadCsv("import_problems", ["Row", "USN", "Name", "Problems"], r.report.filter((x) => !x.ok).map((x) => [x.row, x.usn, x.name, x.problems.join("; ")]));
  const loginSheet = (r: Result) => downloadCsv("new_student_logins", ["USN", "Email", "Temporary password"], r.logins.map((l) => [l.usn, l.email, l.temporary_password]));

  const result = done || preview;
  const rows = result ? result.report.filter((r) => !onlyProblems || !r.ok) : [];

  return (
    <>
      <Topbar greeting="Bulk Import" subtitle="Dashboard > Bulk Import" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6 max-w-5xl">
        <Card>
          <SectionTitle
            title="Add students from a spreadsheet"
            subtitle="Every row is checked first. Nothing is saved until you confirm, and rows with problems are skipped."
            action={<Button variant="secondary" size="sm" className="min-h-[44px] shrink-0" onClick={template}><Download size={14} /> Template</Button>}
          />
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <input ref={fileInput} type="file" accept=".csv,.xlsx" className="sr-only" id="import-file" onChange={(e) => choose(e.target.files?.[0] || null)} />
              <label htmlFor="import-file" className="flex flex-col items-center justify-center gap-2 min-h-[140px] rounded-2xl border-2 border-dashed border-gray-200 hover:border-brand/50 hover:bg-brand-50 cursor-pointer text-center p-4 transition-colors">
                <FileSpreadsheet size={26} className="text-brand" />
                <span className="text-sm font-medium text-ink break-all">{file ? file.name : "Choose a .csv or .xlsx file"}</span>
                <span className="text-xs text-muted">Columns: USN, Name, Batch (entry year). Optional: Semester, Section, CGPA</span>
              </label>
            </div>
            <div className="space-y-3">
              <div>
                <label htmlFor="import-dept" className="text-xs font-medium text-muted mb-1 block">Add them to department</label>
                <select id="import-dept" value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPreview(null); }} className="w-full border border-gray-200 bg-white rounded-xl px-3.5 min-h-[44px] text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30">
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <label className="flex items-start gap-3 min-h-[44px] text-sm text-ink cursor-pointer">
                <input type="checkbox" checked={createLogins} onChange={(e) => setCreateLogins(e.target.checked)} className="w-5 h-5 mt-0.5 accent-[#5B3FD9]" />
                <span>Also create a login for each student<span className="block text-xs text-muted">Email is usn@anviksha.ai, with a temporary password you can download once.</span></span>
              </label>
              <Button className="w-full min-h-[44px]" disabled={!file || busy} onClick={check}><Upload size={15} /> {busy && !confirming ? "Checking…" : "Check the file"}</Button>
            </div>
          </div>
        </Card>

        {result && (
          <Card>
            <SectionTitle
              title={done ? "Import finished" : "Check result"}
              subtitle={done ? `${done.created} added to ${done.department}. ${done.invalid} row${done.invalid === 1 ? " was" : "s were"} skipped.` : `${result.rows} rows read for ${result.department}. Nothing has been saved yet.`}
            />
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-xl bg-gray-50 p-3"><div className="text-xs text-muted">Rows</div><div className="text-2xl font-extrabold font-display text-ink numeric">{result.rows}</div></div>
              <div className="rounded-xl bg-success/10 p-3"><div className="text-xs text-muted">{done ? "Added" : "Ready"}</div><div className="text-2xl font-extrabold font-display text-success numeric">{done ? done.created : result.valid}</div></div>
              <div className="rounded-xl bg-danger/10 p-3"><div className="text-xs text-muted">{done ? "Skipped" : "Problems"}</div><div className="text-2xl font-extrabold font-display text-danger numeric">{result.invalid}</div></div>
            </div>

            <div className="flex flex-wrap gap-2 mb-4">
              {!done && <Button className="min-h-[44px]" disabled={busy || result.valid === 0} onClick={() => setConfirming(true)}><CheckCircle2 size={15} /> Add {result.valid} student{result.valid === 1 ? "" : "s"}</Button>}
              {result.invalid > 0 && <Button variant="secondary" className="min-h-[44px]" onClick={() => errorReport(result)}><Download size={14} /> Problem report</Button>}
              {done && done.logins.length > 0 && <Button className="min-h-[44px]" onClick={() => loginSheet(done)}><Download size={14} /> Download {done.logins.length} login{done.logins.length === 1 ? "" : "s"}</Button>}
              {result.invalid > 0 && (
                <label className="flex items-center gap-2 text-sm text-ink min-h-[44px] ml-auto cursor-pointer">
                  <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} className="w-5 h-5 accent-[#5B3FD9]" /> Show only problems
                </label>
              )}
            </div>
            {done && done.logins.length > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-warning/10 mb-4">
                <AlertTriangle size={16} className="text-[#9c6b12] shrink-0 mt-0.5" />
                <p className="text-sm text-ink">Download the logins now. The temporary passwords can't be shown again after you leave this page — you would have to reset them.</p>
              </div>
            )}

            <div className="overflow-x-auto -mx-6 px-6">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">Row</th><th className="py-2 pr-3 font-medium">USN</th><th className="py-2 pr-3 font-medium">Name</th><th className="py-2 pr-3 font-medium">Batch</th><th className="py-2 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 200).map((r) => (
                    <tr key={r.row} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-3 text-muted numeric">{r.row}</td>
                      <td className="py-2 pr-3 font-medium text-ink">{r.usn || "—"}</td>
                      <td className="py-2 pr-3 text-ink">{r.name || "—"}</td>
                      <td className="py-2 pr-3 text-ink numeric">{r.batch || "—"}</td>
                      <td className="py-2">{r.ok ? <Badge tone="success">{done ? "Added" : "Ready"}</Badge> : <span className="text-danger text-xs">{r.problems.join("; ")}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 200 && <p className="text-xs text-muted mt-2">Showing the first 200 rows. Download the problem report for the full list.</p>}
            </div>
          </Card>
        )}
      </div>

      <CenterModal open={confirming} onClose={() => setConfirming(false)} title="Add these students?" width="max-w-sm">
        <p className="text-sm text-muted mb-5">
          {preview?.valid} student{preview?.valid === 1 ? "" : "s"} will be added to {preview?.department}{createLogins ? ", each with a login" : ""}.
          {preview && preview.invalid > 0 ? ` ${preview.invalid} row${preview.invalid === 1 ? "" : "s"} with problems will be skipped.` : ""}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1 min-h-[44px]" onClick={() => setConfirming(false)}>Cancel</Button>
          <Button className="flex-1 min-h-[44px]" onClick={apply}>Add students</Button>
        </div>
      </CenterModal>
    </>
  );
}
