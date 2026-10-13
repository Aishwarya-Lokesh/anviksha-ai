"use client";

import { useEffect, useState } from "react";
import { Copy, KeyRound, Plus, Search, ShieldCheck, UserCog, UserX } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";

type Login = { id: number; email: string; role: string; name: string | null; detail: string | null; active: boolean; department_id: number | null };

const ROLES = [
  { key: "student", label: "Student" },
  { key: "teacher", label: "Teacher" },
  { key: "hod", label: "HOD" },
  { key: "admin", label: "Admin" },
];
const ROLE_TONE: Record<string, "brand" | "info" | "warning" | "danger"> = { student: "brand", teacher: "info", hod: "warning", admin: "danger" };
const INPUT = "w-full border border-gray-200 bg-white rounded-xl px-3.5 min-h-[44px] text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30";

export default function LoginsPage() {
  const { push } = useToast();
  const [data, setData] = useState<{ total: number; logins: Login[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [role, setRole] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ email: "", role: "student", student_id: "", faculty_id: "", department_id: "", display_name: "" });
  const [students, setStudents] = useState<any[]>([]);
  const [faculty, setFaculty] = useState<any[]>([]);
  const [departments, setDepartments] = useState<{ id: number; name: string }[]>([]);
  const [editing, setEditing] = useState<Login | null>(null);
  const [confirm, setConfirm] = useState<{ kind: "reset" | "deactivate"; login: Login } | null>(null);
  const [shown, setShown] = useState<{ email: string; password: string } | null>(null);

  const load = () => {
    setFailed(false);
    const params: Record<string, string> = {};
    if (role) params.role = role;
    if (query.trim()) params.q = query.trim();
    api.adminLogins(params).then(setData).catch(() => setFailed(true));
  };
  // Typing in the search box waits a moment before asking the server.
  useEffect(() => {
    const t = setTimeout(load, query ? 300 : 0);
    return () => clearTimeout(t);
  }, [role, query]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.adminDepartments().then(setDepartments).catch(() => {});
    api.adminStudents().then(setStudents).catch(() => {});
    api.adminFaculty().then(setFaculty).catch(() => {});
  }, []);

  const create = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = { email: form.email, role: form.role };
      if (form.role === "student") payload.student_id = Number(form.student_id) || null;
      if (form.role === "teacher") payload.faculty_id = Number(form.faculty_id) || null;
      if (form.role === "hod") payload.department_id = Number(form.department_id) || null;
      if (form.role === "hod" || form.role === "admin") payload.display_name = form.display_name;
      const res = await api.adminCreateLogin(payload);
      setCreating(false);
      setForm({ email: "", role: "student", student_id: "", faculty_id: "", department_id: "", display_name: "" });
      setShown({ email: res.email, password: res.temporary_password });
      load();
    } catch (e: any) {
      push(e?.detail || "Could not create the login.", "error");
    }
    setSaving(false);
  };

  const changeRole = async (login: Login, next: string) => {
    try {
      await api.adminEditLogin(login.id, { role: next });
      push(`${login.email} is now ${ROLES.find((r) => r.key === next)?.label}.`);
      setEditing(null);
      load();
    } catch (e: any) {
      push(e?.detail || "Could not change the role.", "error");
    }
  };

  const setActive = async (login: Login, active: boolean) => {
    try {
      await api.adminEditLogin(login.id, { active });
      push(active ? `${login.email} can sign in again.` : `${login.email} can no longer sign in.`);
      setConfirm(null);
      load();
    } catch (e: any) {
      push(e?.detail || "Could not update the account.", "error");
    }
  };

  const reset = async (login: Login) => {
    try {
      const res = await api.adminResetPassword(login.id);
      setConfirm(null);
      setShown({ email: res.email, password: res.temporary_password });
    } catch (e: any) {
      push(e?.detail || "Could not reset the password.", "error");
    }
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); push("Copied"); } catch { push("Select the text and copy it manually.", "info"); }
  };

  if (failed && !data) return <><Topbar greeting="Login Accounts" subtitle="Who can sign in" avatarLetter="A" /><LoadError message="We couldn't load the login accounts." onRetry={load} /></>;
  if (!data) return <><Topbar greeting="Login Accounts" subtitle="Loading…" avatarLetter="A" /><DashboardSkeleton /></>;

  const studentsWithoutLogin = students;

  return (
    <>
      <Topbar greeting="Login Accounts" subtitle="Dashboard > Login Accounts" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-5">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="relative flex-1 min-w-[14rem] max-w-md">
            <span className="sr-only">Search logins</span>
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name, email or USN" className={`${INPUT} pl-10`} />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted">
            Role
            <select value={role} onChange={(e) => setRole(e.target.value)} className="border border-gray-200 bg-white rounded-xl px-3 min-h-[44px] text-sm text-ink outline-none">
              <option value="">All roles</option>
              {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </label>
          <Button className="min-h-[44px] ml-auto" onClick={() => setCreating(true)}><Plus size={15} /> New login</Button>
        </div>

        <Card className="!p-0 overflow-hidden">
          <div className="px-5 pt-5"><SectionTitle title={`${data.total} login${data.total === 1 ? "" : "s"}`} subtitle={data.total > data.logins.length ? `Showing the first ${data.logins.length}. Search to narrow down.` : "Passwords are never shown here. Reset one to issue a new temporary password."} /></div>
          {data.logins.length === 0 ? (
            <EmptyState icon={UserCog} title="No login matches" hint="Try a different search or role." />
          ) : (
            <ul className="divide-y divide-gray-100">
              {data.logins.map((l) => (
                <li key={l.id} className="flex items-center gap-3 px-5 py-3 flex-wrap">
                  <div className="flex-1 min-w-[13rem]">
                    <div className="text-sm font-medium text-ink break-all">{l.name || l.email}</div>
                    <div className="text-xs text-muted break-all">{[l.name ? l.email : null, l.detail].filter(Boolean).join(" · ")}</div>
                  </div>
                  <Badge tone={ROLE_TONE[l.role] || "neutral"}>{ROLES.find((r) => r.key === l.role)?.label || l.role}</Badge>
                  {!l.active && <Badge tone="neutral">Deactivated</Badge>}
                  <div className="flex gap-1">
                    <button title="Change role" aria-label={`Change role of ${l.email}`} onClick={() => setEditing(l)} className="w-11 h-11 rounded-xl text-muted hover:text-brand hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><ShieldCheck size={16} /></button>
                    <button title="Reset password" aria-label={`Reset password of ${l.email}`} onClick={() => setConfirm({ kind: "reset", login: l })} className="w-11 h-11 rounded-xl text-muted hover:text-brand hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><KeyRound size={16} /></button>
                    {l.active ? (
                      <button title="Deactivate" aria-label={`Deactivate ${l.email}`} onClick={() => setConfirm({ kind: "deactivate", login: l })} className="w-11 h-11 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><UserX size={16} /></button>
                    ) : (
                      <button onClick={() => setActive(l, true)} className="px-3 min-h-[44px] rounded-xl text-xs font-semibold text-success hover:bg-success/10 outline-none focus-visible:ring-2 focus-visible:ring-brand/40">Reactivate</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CenterModal open={creating} onClose={() => !saving && setCreating(false)} title="New login">
        <div className="space-y-3">
          <div>
            <label htmlFor="lg-role" className="text-xs font-medium text-muted mb-1 block">Role</label>
            <select id="lg-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={INPUT}>
              {ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
          {form.role === "student" && (
            <div>
              <label htmlFor="lg-student" className="text-xs font-medium text-muted mb-1 block">Student record</label>
              <select id="lg-student" value={form.student_id} onChange={(e) => { const s = studentsWithoutLogin.find((x: any) => String(x.id) === e.target.value); setForm({ ...form, student_id: e.target.value, email: form.email || (s?.usn ? `${String(s.usn).toLowerCase()}@anviksha.ai` : "") }); }} className={INPUT}>
                <option value="">Choose a student…</option>
                {studentsWithoutLogin.map((s: any) => <option key={s.id} value={s.id}>{s.usn} — {s.name}</option>)}
              </select>
            </div>
          )}
          {form.role === "teacher" && (
            <div>
              <label htmlFor="lg-faculty" className="text-xs font-medium text-muted mb-1 block">Faculty record</label>
              <select id="lg-faculty" value={form.faculty_id} onChange={(e) => setForm({ ...form, faculty_id: e.target.value })} className={INPUT}>
                <option value="">Choose a faculty member…</option>
                {faculty.map((f: any) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
          )}
          {form.role === "hod" && (
            <div>
              <label htmlFor="lg-dept" className="text-xs font-medium text-muted mb-1 block">Department</label>
              <select id="lg-dept" value={form.department_id} onChange={(e) => setForm({ ...form, department_id: e.target.value })} className={INPUT}>
                <option value="">Choose a department…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          {(form.role === "hod" || form.role === "admin") && (
            <div>
              <label htmlFor="lg-name" className="text-xs font-medium text-muted mb-1 block">Name <span className="font-normal">(optional)</span></label>
              <input id="lg-name" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} className={INPUT} />
            </div>
          )}
          <div>
            <label htmlFor="lg-email" className="text-xs font-medium text-muted mb-1 block">Email used to sign in</label>
            <input id="lg-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="name@anviksha.ai" className={INPUT} />
          </div>
          <p className="text-xs text-muted">A temporary password is created for you and shown once after saving.</p>
          <Button className="w-full min-h-[44px]" disabled={saving || !form.email.trim()} onClick={create}>{saving ? "Creating…" : "Create login"}</Button>
        </div>
      </CenterModal>

      <CenterModal open={!!editing} onClose={() => setEditing(null)} title="Change role" width="max-w-sm">
        {editing && (
          <div>
            <p className="text-sm text-muted mb-4 break-all">{editing.email} is currently <span className="font-semibold text-ink">{ROLES.find((r) => r.key === editing.role)?.label}</span>.</p>
            <div className="space-y-2">
              {ROLES.filter((r) => r.key !== editing.role).map((r) => (
                <Button key={r.key} variant="secondary" className="w-full min-h-[44px]" onClick={() => changeRole(editing, r.key)}>Make {r.label}</Button>
              ))}
            </div>
            <p className="text-xs text-muted mt-4">A login can become a student or teacher only if it is linked to that record.</p>
          </div>
        )}
      </CenterModal>

      <CenterModal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.kind === "reset" ? "Reset this password?" : "Deactivate this login?"} width="max-w-sm">
        {confirm && (
          <>
            <p className="text-sm text-muted mb-5 break-all">
              {confirm.kind === "reset"
                ? `${confirm.login.email} will get a new temporary password and the old one will stop working at once.`
                : `${confirm.login.email} will be signed out and unable to sign in until reactivated. Nothing is deleted.`}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1 min-h-[44px]" onClick={() => setConfirm(null)}>Cancel</Button>
              <Button variant={confirm.kind === "reset" ? "primary" : "danger"} className="flex-1 min-h-[44px]" onClick={() => (confirm.kind === "reset" ? reset(confirm.login) : setActive(confirm.login, false))}>
                {confirm.kind === "reset" ? "Reset password" : "Deactivate"}
              </Button>
            </div>
          </>
        )}
      </CenterModal>

      <CenterModal open={!!shown} onClose={() => setShown(null)} title="Temporary password" width="max-w-sm">
        {shown && (
          <>
            <p className="text-sm text-muted mb-3">Pass this on now. It is shown only once and can't be looked up later.</p>
            <div className="rounded-xl bg-gray-50 p-3 space-y-1">
              <div className="text-xs text-muted">Email</div>
              <div className="text-sm font-medium text-ink break-all">{shown.email}</div>
              <div className="text-xs text-muted pt-2">Password</div>
              <div className="text-lg font-mono font-bold text-ink tracking-wide break-all">{shown.password}</div>
            </div>
            <div className="flex gap-2 mt-4">
              <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={() => copy(`${shown.email} / ${shown.password}`)}><Copy size={14} /> Copy</Button>
              <Button className="flex-1 min-h-[44px]" onClick={() => setShown(null)}>Done</Button>
            </div>
          </>
        )}
      </CenterModal>
    </>
  );
}
