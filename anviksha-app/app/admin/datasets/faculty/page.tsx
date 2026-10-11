"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { Search, Upload, Plus, Trash2 } from "lucide-react";
import { LoadError, EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api";
import { downloadExcel } from "@/lib/fileGen";

export default function FacultyDatasetPage() {
  const [query, setQuery] = useState("");
  const { push } = useToast();
  const [faculty, setFaculty] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", designation: "", email: "" });

  const load = () => {
    setLoadError(false);
    api.adminFaculty().then(setFaculty).catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const filtered = useMemo(() => (faculty || []).filter((f: any) => (f.name || "").toLowerCase().includes(query.toLowerCase())), [query, faculty]);

  const addFaculty = async () => {
    if (!form.name) return;
    try {
      const res = await api.adminFacultyCreate(form);
      setFaculty([res, ...(faculty || [])]);
      push("Faculty added");
      setOpen(false);
      setForm({ name: "", designation: "", email: "" });
    } catch {
      push("Could not add the faculty member. Please try again.", "error");
    }
  };

  const removeFaculty = async (id: number) => {
    try {
      await api.adminFacultyDelete(id);
      setFaculty((faculty || []).filter((f: any) => f.id !== id));
      push("Faculty removed");
    } catch {
      push("Could not remove the faculty member. Please try again.", "error");
    }
  };

  return (
    <>
      <Topbar greeting="Faculty Dataset" subtitle="Dashboard > Faculty Dataset" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search faculty..." className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl outline-none w-64" />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => downloadExcel(filtered.map((f: any) => ({ Name: f.name, Designation: f.designation, Email: f.email })), "Faculty_Export", "Faculty")}><Upload size={15} /> Export</Button>
              <Button onClick={() => setOpen(true)}><Plus size={15} /> Add Faculty</Button>
            </div>
          </div>
          {loadError ? <LoadError message="We couldn't load the faculty list." onRetry={load} /> : faculty === null ? (
            <p className="text-sm text-muted text-center py-10">Loading faculty…</p>
          ) : filtered.length === 0 ? (
            <EmptyState title={query ? "No faculty match your search" : "No faculty added yet"} hint={query ? undefined : "Use Add Faculty to create the first record."} />
          ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-muted border-b border-gray-100">
                <th className="py-2.5 font-medium">Name</th><th className="py-2.5 font-medium">Designation</th>
                <th className="py-2.5 font-medium">Qualifications</th><th className="py-2.5 font-medium">Email</th><th className="py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f: any) => (
                <tr key={f.id} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                  <td className="py-3 font-medium text-ink">{f.name}</td>
                  <td className="py-3 text-muted">{f.designation}{f.vtu_teacher_id && <Badge tone="success" className="ml-2">Verified</Badge>}</td>
                  <td className="py-3 text-muted">{f.qualifications || "—"}</td>
                  <td className="py-3 text-brand">{f.email || "—"}</td>
                  <td className="py-3"><button onClick={() => removeFaculty(f.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}
        </Card>
      </div>

      <CenterModal open={open} onClose={() => setOpen(false)} title="Add Faculty">
        <div className="space-y-4">
          <div><label className="text-xs font-medium text-muted mb-1 block">Full Name</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" /></div>
          <div><label className="text-xs font-medium text-muted mb-1 block">Designation</label><input value={form.designation} onChange={(e) => setForm({ ...form, designation: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" /></div>
          <div><label className="text-xs font-medium text-muted mb-1 block">Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" /></div>
          <Button className="w-full" onClick={addFaculty}>Add Faculty</Button>
        </div>
      </CenterModal>
    </>
  );
}
