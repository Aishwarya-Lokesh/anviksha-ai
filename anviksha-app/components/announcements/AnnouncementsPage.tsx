"use client";

import { useEffect, useState } from "react";
import { Megaphone, Plus, Trash2, Trophy } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";

type Announcement = {
  id: number; title: string; body: string; kind: string; audience: string; batch: string | null; semester: number | null;
  author_name: string; author_role: string; created_at: string | null; mine: boolean; can_delete: boolean;
};
type Role = "student" | "teacher" | "hod" | "admin";
type ClassOption = { batch: string; semester: number };

const ROLE_WORD: Record<string, string> = { teacher: "Faculty", hod: "HOD", admin: "Administration" };
const AUDIENCE_WORD: Record<string, string> = { students: "Students", faculty: "Faculty", everyone: "Everyone" };
const INPUT = "w-full border border-gray-200 bg-white rounded-xl px-3.5 min-h-[44px] text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30";

/** The announcements feed for every role; teachers, HODs and admins can also post. */
export function AnnouncementsPage({ role }: { role: Role }) {
  const letter = role[0].toUpperCase();
  const canPost = role !== "student";
  const { push } = useToast();
  const [items, setItems] = useState<Announcement[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<"all" | "notice" | "placement">("all");
  const [composing, setComposing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Announcement | null>(null);
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [form, setForm] = useState({ title: "", body: "", audience: role === "teacher" ? "students" : "everyone", classKey: "", departmentId: "", batch: "" });

  const load = () => {
    setFailed(false);
    api.announcements().then(setItems).catch(() => setFailed(true));
  };
  useEffect(() => {
    load();
    if (role === "teacher") {
      api.teacherAssignments().then((rows: any[]) => {
        const seen = new Set<string>();
        const list: ClassOption[] = [];
        for (const r of rows) {
          const key = `${r.batch}|${r.semester}`;
          if (r.passed_out || !r.batch || !r.semester || seen.has(key)) continue;
          seen.add(key);
          list.push({ batch: r.batch, semester: r.semester });
        }
        setClasses(list);
        if (list.length) setForm((f) => ({ ...f, classKey: `${list[0].batch}|${list[0].semester}` }));
      }).catch(() => {});
    }
    if (role === "admin") api.adminDepartments().then(setDepartments).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    if (saving) return;
    if (!form.title.trim() || !form.body.trim()) { push("Write a title and a message first.", "error"); return; }
    const payload: Record<string, unknown> = { title: form.title, body: form.body, audience: form.audience };
    if (role === "teacher") {
      if (!form.classKey) { push("You need an active class to announce to.", "error"); return; }
      const [batch, semester] = form.classKey.split("|");
      payload.batch = batch;
      payload.semester = Number(semester);
    } else {
      if (form.batch.trim() && form.audience !== "faculty") payload.batch = form.batch.trim();
      if (role === "admin" && form.departmentId) payload.department_id = Number(form.departmentId);
    }
    setSaving(true);
    try {
      const res = await api.postAnnouncement(payload);
      push(`Announcement posted. ${res.notified} ${res.notified === 1 ? "person was" : "people were"} notified.`);
      setComposing(false);
      setForm((f) => ({ ...f, title: "", body: "" }));
      load();
    } catch (e: any) {
      push(e?.detail || "Could not post the announcement. Please try again.", "error");
    }
    setSaving(false);
  };

  const remove = async () => {
    if (!toDelete) return;
    try { await api.deleteAnnouncement(toDelete.id); push("Announcement deleted"); setToDelete(null); load(); }
    catch (e: any) { push(e?.detail || "Could not delete. Please try again.", "error"); }
  };

  if (failed) return <><Topbar greeting="Announcements" subtitle="Notices and placement news" avatarLetter={letter} /><LoadError message="We couldn't load announcements." onRetry={load} /></>;
  if (!items) return <><Topbar greeting="Announcements" subtitle="Loading…" avatarLetter={letter} /><DashboardSkeleton /></>;

  const shown = items.filter((a) => filter === "all" || (filter === "placement" ? a.kind === "placement" : a.kind !== "placement"));
  const hasPlacementNews = items.some((a) => a.kind === "placement");

  return (
    <>
      <Topbar greeting="Announcements" subtitle="Dashboard > Announcements" avatarLetter={letter} />
      <div className="p-4 md:p-8 space-y-5 max-w-4xl">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-1 bg-gray-100 rounded-xl p-1" role="tablist" aria-label="Filter announcements">
            {([["all", "All"], ["notice", "Notices"], ["placement", "Placement wall"]] as const).filter(([k]) => k !== "placement" || hasPlacementNews).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={`px-3 min-h-[40px] rounded-lg text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${filter === k ? "bg-brand text-white" : "text-muted hover:text-ink"}`}>{label}</button>
            ))}
          </div>
          {canPost && <Button className="min-h-[44px]" onClick={() => setComposing(true)}><Plus size={15} /> New announcement</Button>}
        </div>

        {shown.length === 0 ? (
          <Card>
            <EmptyState
              icon={Megaphone}
              title={items.length === 0 ? "No announcements yet" : "Nothing in this view"}
              hint={canPost ? "Post a notice and everyone it is meant for gets a notification." : "Notices from your teachers, HOD and the college will appear here."}
              action={canPost && items.length === 0 ? <Button className="min-h-[44px]" onClick={() => setComposing(true)}><Plus size={15} /> Post the first one</Button> : undefined}
            />
          </Card>
        ) : (
          <ul className="space-y-4">
            {shown.map((a) => {
              const placement = a.kind === "placement";
              return (
                <li key={a.id}>
                  <Card className="!p-5">
                    <div className="flex items-start gap-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${placement ? "bg-success/10" : "bg-brand-light"}`}>
                        {placement ? <Trophy size={18} className="text-success" /> : <Megaphone size={18} className="text-brand" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2 className="text-base font-semibold text-ink break-words">{a.title}</h2>
                        <div className="text-xs text-muted mt-0.5">
                          {a.author_name}{!placement && ROLE_WORD[a.author_role] ? ` · ${ROLE_WORD[a.author_role]}` : ""} · {a.created_at?.replace("T", " ").slice(0, 16)}
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {placement && <Badge tone="success">Placement</Badge>}
                          {canPost && <Badge tone="neutral">To: {AUDIENCE_WORD[a.audience] || a.audience}{a.batch ? ` · Batch ${a.batch}` : ""}{a.semester ? ` · Sem ${a.semester}` : ""}</Badge>}
                          {a.mine && <Badge tone="brand">Posted by you</Badge>}
                        </div>
                        <div className="mt-3 text-sm"><Markdown text={a.body} /></div>
                      </div>
                      {a.can_delete && (
                        <button aria-label={`Delete announcement ${a.title}`} onClick={() => setToDelete(a)} className="w-11 h-11 -mt-1 -mr-2 shrink-0 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Trash2 size={16} /></button>
                      )}
                    </div>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <CenterModal open={composing} onClose={() => !saving && setComposing(false)} title="New announcement">
        <div className="space-y-3">
          <div>
            <label htmlFor="an-title" className="text-xs font-medium text-muted mb-1 block">Title</label>
            <input id="an-title" autoFocus maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Internal assessment 2 timetable" className={INPUT} />
          </div>
          <div>
            <label htmlFor="an-body" className="text-xs font-medium text-muted mb-1 block">Message</label>
            <textarea id="an-body" rows={5} maxLength={5000} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} className="w-full border border-gray-200 bg-white rounded-xl px-3.5 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          {role === "teacher" ? (
            <div>
              <label htmlFor="an-class" className="text-xs font-medium text-muted mb-1 block">Send to the students of</label>
              {classes.length === 0 ? (
                <p className="text-sm text-muted">You have no active class yet. Add a teaching assignment from your dashboard first.</p>
              ) : (
                <select id="an-class" value={form.classKey} onChange={(e) => setForm({ ...form, classKey: e.target.value })} className={INPUT}>
                  {classes.map((c) => <option key={`${c.batch}|${c.semester}`} value={`${c.batch}|${c.semester}`}>Batch {c.batch} · Semester {c.semester}</option>)}
                </select>
              )}
            </div>
          ) : (
            <>
              <div>
                <label htmlFor="an-audience" className="text-xs font-medium text-muted mb-1 block">Send to</label>
                <select id="an-audience" value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value })} className={INPUT}>
                  <option value="everyone">Everyone (students and faculty)</option>
                  <option value="students">Students only</option>
                  <option value="faculty">Faculty only</option>
                </select>
              </div>
              {role === "admin" && (
                <div>
                  <label htmlFor="an-dept" className="text-xs font-medium text-muted mb-1 block">Department</label>
                  <select id="an-dept" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })} className={INPUT}>
                    <option value="">All departments</option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
              )}
              {form.audience !== "faculty" && (
                <div>
                  <label htmlFor="an-batch" className="text-xs font-medium text-muted mb-1 block">Only one batch? <span className="font-normal">(optional — entry year, e.g. 2023)</span></label>
                  <input id="an-batch" inputMode="numeric" maxLength={4} value={form.batch} onChange={(e) => setForm({ ...form, batch: e.target.value.replace(/\D/g, "") })} placeholder="All batches" className={INPUT} />
                </div>
              )}
              {role === "hod" && <p className="text-xs text-muted">This goes to your department only.</p>}
            </>
          )}
          <Button className="w-full min-h-[44px]" disabled={saving || (role === "teacher" && classes.length === 0)} onClick={submit}>{saving ? "Posting…" : "Post announcement"}</Button>
        </div>
      </CenterModal>

      <CenterModal open={!!toDelete} onClose={() => setToDelete(null)} title="Delete this announcement?" width="max-w-sm">
        <p className="text-sm text-muted mb-5">"{toDelete?.title}" will disappear for everyone. This can't be undone.</p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1 min-h-[44px]" onClick={() => setToDelete(null)}>Cancel</Button>
          <Button variant="danger" className="flex-1 min-h-[44px]" onClick={remove}>Delete</Button>
        </div>
      </CenterModal>
    </>
  );
}
