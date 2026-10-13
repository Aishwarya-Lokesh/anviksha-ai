"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { SimpleBarChart } from "@/components/charts/Charts";
import { Download, Pencil } from "lucide-react";
import { downloadCsv } from "@/lib/csv";
import { api } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

const EXTRA_WORK_PRESETS = ["NA", "Class Coordinator", "Placement Coordinator", "Exam Coordinator", "Project Coordinator", "NAAC Work", "Department Coordinator", "Club Coordinator"];

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  completed: "success",
  pending: "warning",
};

export default function HodFacultyPage() {
  const [faculty, setFaculty] = useState<any[] | null>(null);
  const [workload, setWorkload] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [extraWorkValue, setExtraWorkValue] = useState("");
  const [customMode, setCustomMode] = useState(false);
  const [viewingSubjectsFor, setViewingSubjectsFor] = useState<any>(null);
  const [subjectsForFaculty, setSubjectsForFaculty] = useState<any[]>([]);
  const { push } = useToast();

  const loadFaculty = () => api.hodFaculty().then(setFaculty).catch(() => setFaculty([]));

  useEffect(() => {
    loadFaculty();
    api.hodFacultyWorkload().then(setWorkload).catch(() => {});
  }, []);

  const openEdit = (f: any) => {
    setEditing(f);
    const isPreset = EXTRA_WORK_PRESETS.includes(f.extra_work);
    setExtraWorkValue(f.extra_work || "NA");
    setCustomMode(!isPreset);
  };

  const saveExtraWork = async () => {
    if (!editing) return;
    try {
      await api.hodUpdateExtraWork(editing.id, extraWorkValue);
      push("Extra Work saved");
      setEditing(null);
      loadFaculty();
    } catch {
      push("Could not save. Please try again.", "error");
    }
  };

  const openSubjects = async (f: any) => {
    setViewingSubjectsFor(f);
    try {
      const res = await api.hodFacultySubjects(f.id);
      setSubjectsForFaculty(res.subjects || []);
    } catch {
      setSubjectsForFaculty([]);
    }
  };

  if (!faculty) return <><Topbar greeting="Faculty Workload" subtitle="Loading..." avatarLetter="H" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="Faculty Workload" subtitle="Dashboard > Faculty Workload" avatarLetter="H" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <SectionTitle title="Subjects Handled by Faculty" subtitle="From each teacher's own Teaching Assignments" />
          <SimpleBarChart data={workload.map((w) => ({ label: w.name, value: w.subject_count }))} xKey="label" barKey="value" color="#5B3FD9" />
        </Card>
        <Card hover>
          <SectionTitle
            title="Faculty Directory"
            action={
              <Button variant="secondary" size="sm" className="min-h-[44px] shrink-0" disabled={faculty.length === 0}
                onClick={() => { downloadCsv("faculty_workload", ["Name", "Designation", "Subjects handled", "Extra work", "Extra work status"], faculty.map((f: any) => [f.name, f.designation, f.subjects_handled, f.extra_work, f.extra_work_status || ""])); push("Faculty list exported"); }}>
                <Download size={14} /> Export
              </Button>
            }
          />
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-left text-muted border-b border-gray-100">
                <th className="py-2.5 font-medium">Name</th><th className="py-2.5 font-medium">Designation</th>
                <th className="py-2.5 font-medium">Subjects</th><th className="py-2.5 font-medium">Extra Work</th>
                <th className="py-2.5 font-medium">Status</th><th className="py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {faculty.map((f: any) => (
                <tr key={f.id} className="border-b border-gray-50">
                  <td className="py-3 font-medium text-ink">{f.name}</td>
                  <td className="py-3 text-muted">{f.designation}</td>
                  <td className="py-3">
                    <button onClick={() => openSubjects(f)} className="text-brand hover:underline font-medium">
                      {f.subjects_handled}
                    </button>
                  </td>
                  <td className="py-3">{f.extra_work === "NA" ? <span className="text-muted">NA</span> : <Badge tone="brand">{f.extra_work}</Badge>}</td>
                  <td className="py-3">
                    {f.extra_work_status ? <Badge tone={STATUS_TONE[f.extra_work_status] || "neutral"}>{f.extra_work_status === "completed" ? "Completed" : "Pending"}</Badge> : <span className="text-muted">—</span>}
                  </td>
                  <td className="py-3"><button onClick={() => openEdit(f)} className="p-1.5 rounded-lg hover:bg-brand-light text-brand"><Pencil size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      </div>

      <CenterModal open={!!editing} onClose={() => setEditing(null)} title="Edit Faculty Work">
        {editing && (
          <div className="space-y-4">
            <div>
              <div className="text-xs text-muted">Faculty Name</div>
              <div className="text-sm font-medium text-ink">{editing.name}</div>
            </div>
            <div>
              <div className="text-xs text-muted">Subjects Handled</div>
              <div className="text-sm font-medium text-ink">{editing.subjects_handled}</div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Extra Work</label>
              {!customMode ? (
                <select value={extraWorkValue} onChange={(e) => { if (e.target.value === "__custom") { setCustomMode(true); setExtraWorkValue(""); } else setExtraWorkValue(e.target.value); }} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none">
                  {EXTRA_WORK_PRESETS.map((p) => <option key={p} value={p}>{p}</option>)}
                  <option value="__custom">Custom...</option>
                </select>
              ) : (
                <input value={extraWorkValue} onChange={(e) => setExtraWorkValue(e.target.value)} placeholder="Enter custom extra work" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
              )}
              <p className="text-[11px] text-muted mt-1">Saving a new extra work item resets its status to Pending and shows up on this teacher's own dashboard.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setEditing(null)}>Cancel</Button>
              <Button className="flex-1" onClick={saveExtraWork}>Save Changes</Button>
            </div>
          </div>
        )}
      </CenterModal>

      <CenterModal open={!!viewingSubjectsFor} onClose={() => setViewingSubjectsFor(null)} title={viewingSubjectsFor ? `Subjects — ${viewingSubjectsFor.name}` : "Subjects"}>
        {subjectsForFaculty.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No teaching assignments configured for this faculty member yet.</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto">
            {subjectsForFaculty.map((s: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-xl bg-gray-50">
                <div>
                  <div className="text-sm font-medium text-ink">{s.code} — {s.name}</div>
                  <div className="text-xs text-muted">Batch {s.batch} · Sem {s.semester}{s.section ? ` · Section ${s.section}` : ""}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CenterModal>
    </>
  );
}
