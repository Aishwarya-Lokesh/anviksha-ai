"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, Building2, Pencil, Plus, Search } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";

type Batch = { batch: string; students: number; active: number; semesters: number[] };
type Dept = { id: number; name: string; faculty: number; subjects: number; subjects_without_faculty: number; students: number; batches: Batch[] };
type Subject = { id: number; code: string; name: string; semester: number | null; department_id: number | null; faculty_id: number | null; faculty_name: string | null };
type FacultyOption = { id: number; name: string; department_id: number | null };

const INPUT = "w-full border border-gray-200 bg-white rounded-xl px-3.5 min-h-[44px] text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30";

export default function StructurePage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = params.get("tab") === "subjects" ? "subjects" : "departments";
  const { push } = useToast();

  const [depts, setDepts] = useState<Dept[] | null>(null);
  const [alloc, setAlloc] = useState<{ subjects: Subject[]; faculty: FacultyOption[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [deptForm, setDeptForm] = useState<{ id: number | null; name: string } | null>(null);
  const [subjectForm, setSubjectForm] = useState<{ code: string; name: string; semester: string; department_id: string; faculty_id: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [semester, setSemester] = useState("");
  const [onlyUnallocated, setOnlyUnallocated] = useState(false);
  const [busySubject, setBusySubject] = useState<number | null>(null);

  const load = () => {
    setFailed(false);
    Promise.all([api.adminStructure(), api.adminSubjectAllocation()])
      .then(([d, a]) => { setDepts(d); setAlloc(a); })
      .catch(() => setFailed(true));
  };
  useEffect(load, []);

  const saveDept = async () => {
    if (!deptForm || saving) return;
    setSaving(true);
    try {
      if (deptForm.id) await api.adminRenameDepartment(deptForm.id, deptForm.name); else await api.adminCreateDepartment(deptForm.name);
      push(deptForm.id ? "Department renamed" : "Department added");
      setDeptForm(null);
      load();
    } catch (e: any) {
      push(e?.detail || "Could not save the department.", "error");
    }
    setSaving(false);
  };

  const saveSubject = async () => {
    if (!subjectForm || saving) return;
    setSaving(true);
    try {
      await api.adminCreateSubject({
        code: subjectForm.code, name: subjectForm.name, semester: subjectForm.semester ? Number(subjectForm.semester) : null,
        department_id: subjectForm.department_id ? Number(subjectForm.department_id) : null, faculty_id: subjectForm.faculty_id ? Number(subjectForm.faculty_id) : null,
      });
      push("Subject added");
      setSubjectForm(null);
      load();
    } catch (e: any) {
      push(e?.detail || "Could not add the subject.", "error");
    }
    setSaving(false);
  };

  const allocate = async (s: Subject, facultyId: string) => {
    setBusySubject(s.id);
    try {
      const updated: Subject = await api.adminEditSubject(s.id, { faculty_id: facultyId ? Number(facultyId) : 0 });
      setAlloc((a) => a && { ...a, subjects: a.subjects.map((x) => (x.id === s.id ? { ...x, faculty_id: updated.faculty_id, faculty_name: updated.faculty_name } : x)) });
      push(updated.faculty_name ? `${s.code} allocated to ${updated.faculty_name}` : `${s.code} is now unallocated`);
    } catch (e: any) {
      push(e?.detail || "Could not change the allocation.", "error");
    }
    setBusySubject(null);
  };

  const shownSubjects = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (alloc?.subjects || []).filter((s) =>
      (!needle || `${s.code} ${s.name} ${s.faculty_name || ""}`.toLowerCase().includes(needle)) &&
      (!semester || String(s.semester) === semester) && (!onlyUnallocated || !s.faculty_id));
  }, [alloc, query, semester, onlyUnallocated]);

  const title = "Departments & Subjects";
  if (failed) return <><Topbar greeting={title} subtitle="Academic structure" avatarLetter="A" /><LoadError message="We couldn't load the academic structure." onRetry={load} /></>;
  if (!depts || !alloc) return <><Topbar greeting={title} subtitle="Loading…" avatarLetter="A" /><DashboardSkeleton /></>;

  const unallocated = alloc.subjects.filter((s) => !s.faculty_id).length;

  return (
    <>
      <Topbar greeting={title} subtitle="Dashboard > Departments & Subjects" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div role="tablist" aria-label="Structure sections" className="flex gap-1 bg-gray-100 rounded-xl p-1">
            {[["departments", "Departments & batches"], ["subjects", `Subject allocation${unallocated ? ` (${unallocated} open)` : ""}`]].map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} onClick={() => router.replace(k === "departments" ? pathname : `${pathname}?tab=${k}`)} className={`px-3 min-h-[40px] rounded-lg text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${tab === k ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{label}</button>
            ))}
          </div>
          {tab === "departments"
            ? <Button className="min-h-[44px]" onClick={() => setDeptForm({ id: null, name: "" })}><Plus size={15} /> Add department</Button>
            : <Button className="min-h-[44px]" onClick={() => setSubjectForm({ code: "", name: "", semester: "", department_id: String(depts[0]?.id || ""), faculty_id: "" })}><Plus size={15} /> Add subject</Button>}
        </div>

        {tab === "departments" && (depts.length === 0 ? (
          <Card><EmptyState icon={Building2} title="No departments yet" action={<Button className="min-h-[44px]" onClick={() => setDeptForm({ id: null, name: "" })}><Plus size={15} /> Add the first department</Button>} /></Card>
        ) : (
          <div className="space-y-6">
            {depts.map((d) => (
              <Card key={d.id}>
                <div className="flex items-start justify-between gap-3 mb-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-ink break-words">{d.name}</h2>
                    <p className="text-sm text-muted mt-0.5">{d.students} students · {d.faculty} faculty · {d.subjects} subjects{d.subjects_without_faculty ? ` (${d.subjects_without_faculty} without a teacher)` : ""}</p>
                  </div>
                  <button aria-label={`Rename ${d.name}`} onClick={() => setDeptForm({ id: d.id, name: d.name })} className="w-11 h-11 shrink-0 rounded-xl text-muted hover:text-brand hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Pencil size={15} /></button>
                </div>
                {d.batches.length === 0 ? (
                  <p className="text-sm text-muted">No students yet. Add them from Bulk Import or Manage Users; batches appear here on their own.</p>
                ) : (
                  <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    {d.batches.map((b) => (
                      <div key={b.batch} className="rounded-xl border border-gray-100 p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-ink">Batch {b.batch}</div>
                          <Badge tone={b.active > 0 ? "success" : "neutral"}>{b.active > 0 ? "Active" : "Passed out"}</Badge>
                        </div>
                        <div className="text-2xl font-extrabold font-display text-ink numeric mt-2">{b.students}</div>
                        <div className="text-xs text-muted">student{b.students === 1 ? "" : "s"}{b.active > 0 && b.active !== b.students ? ` · ${b.active} active` : ""}</div>
                        {b.semesters.length > 0 && <div className="text-xs text-muted mt-1">Semester {b.semesters.join(", ")}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))}
          </div>
        ))}

        {tab === "subjects" && (
          <Card>
            <SectionTitle title="Who teaches what" subtitle="Choose a faculty member for each subject. Changes save straight away and are written to the activity log." />
            <div className="flex items-center gap-3 flex-wrap mb-4">
              <label className="relative flex-1 min-w-[13rem] max-w-md">
                <span className="sr-only">Search subjects</span>
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by code, subject or teacher" className={`${INPUT} pl-10`} />
              </label>
              <select aria-label="Semester" value={semester} onChange={(e) => setSemester(e.target.value)} className="border border-gray-200 bg-white rounded-xl px-3 min-h-[44px] text-sm text-ink outline-none">
                <option value="">All semesters</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>Semester {n}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-ink min-h-[44px] cursor-pointer">
                <input type="checkbox" checked={onlyUnallocated} onChange={(e) => setOnlyUnallocated(e.target.checked)} className="w-5 h-5 accent-[#5B3FD9]" /> Only without a teacher
              </label>
            </div>
            {shownSubjects.length === 0 ? (
              <EmptyState icon={BookOpen} title={alloc.subjects.length === 0 ? "No subjects yet" : "No subject matches"} compact />
            ) : (
              <ul className="divide-y divide-gray-100">
                {shownSubjects.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2.5 flex-wrap">
                    <div className="flex-1 min-w-[13rem]">
                      <div className="text-sm font-medium text-ink">{s.code} — {s.name}</div>
                      <div className="text-xs text-muted">{s.semester ? `Semester ${s.semester}` : "Semester not set"}</div>
                    </div>
                    <select
                      aria-label={`Faculty for ${s.code}`}
                      value={s.faculty_id ?? ""}
                      disabled={busySubject === s.id}
                      onChange={(e) => allocate(s, e.target.value)}
                      className={`border rounded-xl px-3 min-h-[44px] text-sm outline-none bg-white w-full sm:w-64 disabled:opacity-60 ${s.faculty_id ? "border-gray-200 text-ink" : "border-warning text-muted"}`}
                    >
                      <option value="">Not allocated</option>
                      {alloc.faculty.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <CenterModal open={!!deptForm} onClose={() => !saving && setDeptForm(null)} title={deptForm?.id ? "Rename department" : "Add department"} width="max-w-sm">
        {deptForm && (
          <div className="space-y-3">
            <div>
              <label htmlFor="dp-name" className="text-xs font-medium text-muted mb-1 block">Department name</label>
              <input id="dp-name" autoFocus value={deptForm.name} onChange={(e) => setDeptForm({ ...deptForm, name: e.target.value })} placeholder="e.g. Computer Science and Engineering" className={INPUT} />
            </div>
            <Button className="w-full min-h-[44px]" disabled={saving || deptForm.name.trim().length < 3} onClick={saveDept}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        )}
      </CenterModal>

      <CenterModal open={!!subjectForm} onClose={() => !saving && setSubjectForm(null)} title="Add subject">
        {subjectForm && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label htmlFor="sb-code" className="text-xs font-medium text-muted mb-1 block">Code</label>
                <input id="sb-code" autoFocus value={subjectForm.code} maxLength={12} onChange={(e) => setSubjectForm({ ...subjectForm, code: e.target.value.toUpperCase() })} placeholder="BIS701" className={INPUT} />
              </div>
              <div className="col-span-2">
                <label htmlFor="sb-name" className="text-xs font-medium text-muted mb-1 block">Subject name</label>
                <input id="sb-name" value={subjectForm.name} onChange={(e) => setSubjectForm({ ...subjectForm, name: e.target.value })} className={INPUT} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="sb-sem" className="text-xs font-medium text-muted mb-1 block">Semester</label>
                <select id="sb-sem" value={subjectForm.semester} onChange={(e) => setSubjectForm({ ...subjectForm, semester: e.target.value })} className={INPUT}>
                  <option value="">Not set</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="sb-dept" className="text-xs font-medium text-muted mb-1 block">Department</label>
                <select id="sb-dept" value={subjectForm.department_id} onChange={(e) => setSubjectForm({ ...subjectForm, department_id: e.target.value })} className={INPUT}>
                  {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="sb-fac" className="text-xs font-medium text-muted mb-1 block">Taught by <span className="font-normal">(optional)</span></label>
              <select id="sb-fac" value={subjectForm.faculty_id} onChange={(e) => setSubjectForm({ ...subjectForm, faculty_id: e.target.value })} className={INPUT}>
                <option value="">Not allocated yet</option>
                {alloc.faculty.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <Button className="w-full min-h-[44px]" disabled={saving || !subjectForm.code.trim() || !subjectForm.name.trim()} onClick={saveSubject}>{saving ? "Saving…" : "Add subject"}</Button>
          </div>
        )}
      </CenterModal>
    </>
  );
}
