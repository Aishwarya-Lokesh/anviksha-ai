"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { Search, Upload, Plus, Trash2 } from "lucide-react";
import facultyMock from "@/data/faculty.json";
import { api } from "@/lib/api";
import { downloadExcel } from "@/lib/fileGen";

export default function FacultyDatasetPage() {
  const [query, setQuery] = useState("");
  const { push } = useToast();
  const [faculty, setFaculty] = useState<any[]>(facultyMock);
  const [liveMode, setLiveMode] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", designation: "", email: "" });

  useEffect(() => {
    api.adminFaculty().then((rows) => { setFaculty(rows); setLiveMode(true); }).catch(() => setLiveMode(false));
  }, []);

  const filtered = useMemo(() => faculty.filter((f: any) => (f.name || "").toLowerCase().includes(query.toLowerCase())), [query, faculty]);

  const addFaculty = async () => {
    if (!form.name) return;
    try {
      const res = await api.adminFacultyCreate(form);
      setFaculty([res, ...faculty]);
      push("Faculty added — saved to backend");
    } catch {
      setFaculty([{ id: Date.now(), ...form }, ...faculty]);
      push("Backend unreachable — added locally only", "info");
    }
    setOpen(false);
    setForm({ name: "", designation: "", email: "" });
  };

  const removeFaculty = async (id: number) => {
    try {
      await api.adminFacultyDelete(id);
      push("Faculty removed — saved to backend");
    } catch {
      push("Backend unreachable — removed locally only", "info");
    }
    setFaculty(faculty.filter((f: any) => f.id !== id));
  };

  return (
    <>
      <Topbar greeting="Faculty Dataset" subtitle="Dashboard > Faculty Dataset" avatarLetter="A" />
      <div className="px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Live data from backend" : "○ Mock data (backend not connected)"}
        </span>
        {liveMode && <span className="text-xs text-muted ml-2">Placeholder faculty — replace with real names via + Add</span>}
      </div>
      <div className="p-8 space-y-6">
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
          <table className="w-full text-sm">
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
                  <td className="py-3 text-muted">{f.designation}{f.designation?.includes("Placeholder") && <Badge tone="warning" className="ml-2">Placeholder</Badge>}{f.vtu_teacher_id && <Badge tone="success" className="ml-2">Verified</Badge>}</td>
                  <td className="py-3 text-muted">{f.qualifications || "—"}</td>
                  <td className="py-3 text-brand">{f.email || "—"}</td>
                  <td className="py-3"><button onClick={() => removeFaculty(f.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
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
