"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { PillNav } from "@/components/ui/Tabs";
import { CenterModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { LoadError, EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api";

export default function ManageUsersPage() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState("students");
  const [students, setStudents] = useState<any[]>([]);
  const [faculty, setFaculty] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [liveMode, setLiveMode] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name: "", usn: "", batch: "2024", designation: "", email: "" });
  const [departments, setDepartments] = useState<any[]>([]);
  const [deptFilter, setDeptFilter] = useState("");
  const [semFilter, setSemFilter] = useState("");
  const { push } = useToast();

  useEffect(() => {
    api.adminDepartments().then(setDepartments).catch(() => {});
  }, []);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (deptFilter) params.department_id = deptFilter;
    if (semFilter) params.semester = semFilter;
    setLoadError(false);
    api.adminStudents(params).then((rows) => { setStudents(rows); setLoaded(true); setLiveMode(true); }).catch(() => setLoadError(true));
  }, [deptFilter, semFilter, reloadKey]);

  useEffect(() => {
    const fetcher = deptFilter ? api.adminFacultyByDept(deptFilter) : api.adminFaculty();
    fetcher.then((rows) => setFaculty(rows)).catch(() => {});
  }, [deptFilter]);

  const filteredStudents = students.filter((s: any) => (s.name || "").toLowerCase().includes(query.toLowerCase()));
  const filteredFaculty = faculty.filter((f: any) => (f.name || "").toLowerCase().includes(query.toLowerCase()));

  const openAdd = () => { setEditing(null); setForm({ name: "", usn: "", batch: "2024", designation: "", email: "" }); setOpen(true); };

  useEffect(() => {
    const action = searchParams.get("action");
    if (action === "add-student") { setTab("students"); openAdd(); }
    if (action === "add-faculty") { setTab("faculty"); openAdd(); }
    const linked = searchParams.get("q");
    if (linked) { setTab("students"); setQuery(linked); }
  }, [searchParams]);

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({ name: row.name, usn: row.usn || "", batch: row.batch || "2024", designation: row.designation || "", email: row.email || "" });
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name || form.name.trim().length < 2) { push("Name is required (at least 2 characters)", "error"); return; }
    if (tab === "students" && !editing) {
      if (!form.usn || !/^\d?[A-Za-z]{2,4}\d{2}[A-Za-z]{2}\d{2,4}$/.test(form.usn.trim())) {
        push("USN format looks invalid — expected something like 4GW23IS001", "error");
        return;
      }
    }
    if (tab === "faculty" && form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      push("Email format looks invalid", "error");
      return;
    }
    if (tab === "students") {
      if (editing) {
        try {
          const res = await api.adminStudentEdit(editing.id, { usn: editing.usn, name: form.name, batch: form.batch });
          setStudents(students.map((s: any) => (s.id === editing.id ? res : s)));
          push("Student updated");
        } catch { push("Could not save the student. Please try again.", "error"); return; }
      } else {
        try {
          const res = await api.adminStudentCreate({ usn: form.usn || `NEW-${Date.now()}`, name: form.name, batch: form.batch });
          setStudents([res, ...students]);
          push("Student added");
        } catch (e: any) {
          push(/already/i.test(e?.message || "") ? "A student with that USN already exists." : "Could not add the student. Please try again.", "error");
          return;
        }
      }
    } else {
      if (editing) {
        try {
          const res = await api.adminFacultyEdit(editing.id, { name: form.name, designation: form.designation, email: form.email });
          setFaculty(faculty.map((f: any) => (f.id === editing.id ? res : f)));
          push("Faculty updated");
        } catch { push("Could not save the faculty member. Please try again.", "error"); return; }
      } else {
        try {
          const res = await api.adminFacultyCreate({ name: form.name, designation: form.designation, email: form.email });
          setFaculty([res, ...faculty]);
          push("Faculty added");
        } catch { push("Could not add the faculty member. Please try again.", "error"); return; }
      }
    }
    setOpen(false);
  };

  const deleteStudent = async (id: number, name: string) => {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    if (!window.confirm(`Really sure? This permanently removes ${name} and their records.`)) return;
    try { await api.adminStudentDelete(id); push("Student removed"); }
    catch { push("Could not remove the student. Please try again.", "error"); return; }
    setStudents(students.filter((s: any) => s.id !== id));
  };
  const deleteFaculty = async (id: number, name: string) => {
    if (!window.confirm(`Delete ${name}? This cannot be undone.`)) return;
    if (!window.confirm(`Really sure? This permanently removes ${name}.`)) return;
    try { await api.adminFacultyDelete(id); push("Faculty removed"); }
    catch { push("Could not remove the faculty member. Please try again.", "error"); return; }
    setFaculty(faculty.filter((f: any) => f.id !== id));
  };

  return (
    <>
      <Topbar greeting="Manage Users" subtitle="Dashboard > Manage Users" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PillNav items={[{ key: "students", label: "Students" }, { key: "faculty", label: "Faculty" }]} active={tab} onChange={setTab} />
          <div className="flex items-center gap-3 flex-wrap">
            <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
              <option value="">All Departments</option>
              {departments.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            {tab === "students" && (
              <select value={semFilter} onChange={(e) => setSemFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
                <option value="">All Semesters</option>
                {[1, 2, 3, 4, 5, 6, 7, 8].map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search..." className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl outline-none w-56" />
            </div>
            <Button onClick={openAdd}><Plus size={15} /> Add {tab === "students" ? "Student" : "Faculty"}</Button>
          </div>
        </div>

        <Card hover>
          {loadError ? (
            <LoadError message="We couldn't load users." onRetry={() => setReloadKey((k) => k + 1)} />
          ) : !loaded ? (
            <p className="text-sm text-muted text-center py-10">Loading users…</p>
          ) : (tab === "students" ? filteredStudents : filteredFaculty).length === 0 ? (
            <EmptyState title={query ? "No one matches your search" : tab === "students" ? "No students yet" : "No faculty yet"} hint={query ? undefined : "Use the Add button above to create the first record."} />
          ) : (
          <div className="overflow-x-auto">
          {tab === "students" ? (
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="text-left text-muted border-b border-gray-100">
                  <th className="py-2.5 font-medium">Name</th><th className="py-2.5 font-medium">USN</th>
                  <th className="py-2.5 font-medium">Department</th><th className="py-2.5 font-medium">Semester</th>
                  <th className="py-2.5 font-medium">Batch</th><th className="py-2.5 font-medium">CGPA</th>
                  <th className="py-2.5 font-medium">Backlogs</th><th className="py-2.5 font-medium">Status</th><th className="py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filteredStudents.map((s: any) => (
                    <motion.tr key={s.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                      <td className="py-3 font-medium text-ink">{s.name}</td>
                      <td className="py-3 text-muted">{s.usn}</td>
                      <td className="py-3 text-muted">{s.department || "—"}</td>
                      <td className="py-3 text-muted">{s.semester ?? "—"}</td>
                      <td className="py-3 text-muted">{s.batch}</td>
                      <td className="py-3 numeric">{s.cgpa != null ? Number(s.cgpa).toFixed(2) : "N/A"}</td>
                      <td className="py-3">{s.backlogs}</td>
                      <td className="py-3"><Badge tone={s.status === "active" ? "success" : "neutral"}>{s.status}</Badge></td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(s)} className="p-1.5 rounded-lg hover:bg-brand-light text-brand"><Pencil size={14} /></button>
                          <button onClick={() => deleteStudent(s.id, s.name)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-muted border-b border-gray-100">
                  <th className="py-2.5 font-medium">Name</th><th className="py-2.5 font-medium">Department</th>
                  <th className="py-2.5 font-medium">Designation</th><th className="py-2.5 font-medium">Subjects Handled</th>
                  <th className="py-2.5 font-medium">Semester(s)</th><th className="py-2.5 font-medium">Email</th><th className="py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                <AnimatePresence>
                  {filteredFaculty.map((f: any) => (
                    <motion.tr key={f.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                      <td className="py-3 font-medium text-ink">{f.name}</td>
                      <td className="py-3 text-muted">{f.department || "—"}</td>
                      <td className="py-3 text-muted">{f.designation}</td>
                      <td className="py-3 text-muted">{f.subjects_handled ?? "—"}</td>
                      <td className="py-3 text-muted">{(f.semesters || []).join(", ") || "—"}</td>
                      <td className="py-3 text-brand">{f.email || "—"}</td>
                      <td className="py-3">
                        <div className="flex gap-2">
                          <button onClick={() => openEdit(f)} className="p-1.5 rounded-lg hover:bg-brand-light text-brand"><Pencil size={14} /></button>
                          <button onClick={() => deleteFaculty(f.id, f.name)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger"><Trash2 size={14} /></button>
                        </div>
                      </td>
                    </motion.tr>
                  ))}
                </AnimatePresence>
              </tbody>
            </table>
          )}
          </div>
          )}
        </Card>
      </div>

      <CenterModal open={open} onClose={() => setOpen(false)} title={`${editing ? "Edit" : "Add"} ${tab === "students" ? "Student" : "Faculty"}`}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Full Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
          </div>
          {tab === "students" ? (
            <>
              <div><label className="text-xs font-medium text-muted mb-1 block">USN</label><input value={form.usn} onChange={(e) => setForm({ ...form, usn: e.target.value })} disabled={!!editing} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none disabled:bg-gray-50" /></div>
              <div><label className="text-xs font-medium text-muted mb-1 block">Batch</label><input value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" /></div>
            </>
          ) : (
            <>
              <div><label className="text-xs font-medium text-muted mb-1 block">Designation</label><input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" /></div>
              <div><label className="text-xs font-medium text-muted mb-1 block">Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" /></div>
            </>
          )}
          <Button className="w-full" onClick={submit}>{editing ? "Save Changes" : `Add ${tab === "students" ? "Student" : "Faculty"}`}</Button>
        </div>
      </CenterModal>
    </>
  );
}
