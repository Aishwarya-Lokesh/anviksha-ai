"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Eye, EyeOff, KeyRound, Loader2, Save } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button } from "@/components/ui/Primitives";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api, API_BASE } from "@/lib/api";
import { refreshProfile, useProfile } from "@/lib/useProfile";

const FIELD_LABELS: Record<string, string> = {
  display_name: "Display name",
  title: "Title",
  qualifications: "Qualifications",
};

const DETAIL_LABELS: Record<string, string> = {
  usn: "USN", batch: "Batch", semester: "Semester", section: "Section", department: "Department",
  designation: "Designation", qualifications: "Qualifications", contact_email: "Contact email", title: "Title",
};

const inputClass = "w-full border border-gray-200 rounded-xl px-3.5 min-h-[44px] text-sm outline-none focus:ring-2 focus:ring-brand/30";

function PasswordField({ id, label, value, onChange, autoComplete }: {
  id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="text-xs font-medium text-muted mb-1 block">{label}</label>
      <div className="relative">
        <input id={id} type={show ? "text" : "password"} value={value} autoComplete={autoComplete} onChange={(e) => onChange(e.target.value)} className={`${inputClass} pr-11`} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-0 top-0 w-11 h-11 flex items-center justify-center text-muted hover:text-ink">
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  );
}

/** Change-password form, shared by every role's profile page. */
export function ChangePasswordCard() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { push } = useToast();

  const rules = [
    { ok: next.length >= 8, text: "At least 8 characters" },
    { ok: /[A-Za-z]/.test(next) && /\d/.test(next), text: "Letters and numbers" },
    { ok: next.length > 0 && next === confirm, text: "Both entries match" },
  ];
  const ready = current.length > 0 && rules.every((r) => r.ok);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    setError("");
    try {
      await api.changePassword(current, next);
      setCurrent(""); setNext(""); setConfirm("");
      push("Password changed. Use the new one next time you sign in.");
    } catch (err: any) {
      setError(err?.detail || "Could not change your password. Please try again.");
    }
    setSaving(false);
  };

  return (
    <Card hover>
      <SectionTitle title="Change password" subtitle="You stay signed in on this device" />
      <form onSubmit={submit} className="space-y-4 max-w-md">
        <PasswordField id="pw-current" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <PasswordField id="pw-new" label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        <PasswordField id="pw-confirm" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <ul className="space-y-1">
          {rules.map((r) => (
            <li key={r.text} className={`text-xs flex items-center gap-2 ${r.ok ? "text-success" : "text-muted"}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${r.ok ? "bg-success" : "bg-gray-300"}`} />{r.text}
            </li>
          ))}
        </ul>
        {error && <p role="alert" className="text-xs text-danger">{error}</p>}
        <Button disabled={!ready || saving}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />} {saving ? "Saving…" : "Change password"}
        </Button>
      </form>
    </Card>
  );
}

/** Profile page for staff roles (teacher, HOD, admin). Students have their own, richer page. */
export function AccountPage() {
  const profile = useProfile();
  const [failed, setFailed] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { push } = useToast();

  const load = () => {
    setFailed(false);
    refreshProfile().then((p) => { if (!p) setFailed(true); });
  };
  useEffect(load, []);

  useEffect(() => {
    if (!profile) return;
    setForm({
      display_name: profile.role === "teacher" ? "" : profile.name || "",
      title: profile.details?.title || "",
      qualifications: profile.details?.qualifications || "",
    });
  }, [profile]);

  if (!profile && failed) return <><Topbar greeting="My Profile" subtitle="Your account" avatarLetter="U" /><LoadError message="We couldn't load your profile." onRetry={load} /></>;
  if (!profile) return <><Topbar greeting="My Profile" subtitle="Loading…" avatarLetter="U" /><DashboardSkeleton /></>;

  const editable = profile.editable;
  const dirty = editable.some((f) => (form[f] ?? "") !== (f === "display_name" ? profile.name : profile.details?.[f] || ""));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.display_name !== undefined && editable.includes("display_name") && form.display_name.trim().length < 2) {
      push("Name must be at least 2 characters", "error");
      return;
    }
    setSaving(true);
    try {
      await api.updateAccountProfile(Object.fromEntries(editable.map((f) => [f, form[f] ?? ""])));
      await refreshProfile();
      push("Profile saved");
    } catch (err: any) {
      push(err?.detail || "Could not save your profile. Please try again.", "error");
    }
    setSaving(false);
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) { push("Choose a PNG, JPG or WEBP image", "error"); return; }
    if (file.size > 5 * 1024 * 1024) { push("Image too large (max 5MB)", "error"); return; }
    setUploading(true);
    try {
      await api.uploadAccountPhoto(file);
      await refreshProfile();
      push("Profile photo updated");
    } catch (err: any) {
      push(err?.message || "Photo upload failed", "error");
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const details = Object.entries(profile.details || {}).filter(([k, v]) => v != null && v !== "" && !editable.includes(k));

  return (
    <>
      <Topbar greeting="My Profile" subtitle={`Dashboard > My Profile`} avatarLetter={profile.name.charAt(0)} />
      <div className="p-4 md:p-8 grid lg:grid-cols-3 gap-6">
        <Card hover className="text-center">
          <div className="relative w-24 h-24 mx-auto mb-3">
            {profile.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`${API_BASE}${profile.photo_url}`} alt={`${profile.name}'s photo`} className="w-24 h-24 rounded-full object-cover border-2 border-brand/30" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-brand text-white text-3xl font-bold flex items-center justify-center">{profile.name.charAt(0).toUpperCase()}</div>
            )}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Change profile photo"
              className="absolute -bottom-1 -right-1 w-11 h-11 rounded-full bg-white border border-gray-200 shadow-card flex items-center justify-center text-brand hover:bg-brand-light"
            >
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            </button>
            <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => onPhoto(e.target.files?.[0])} />
          </div>
          <div className="text-lg font-bold font-display text-ink break-words">{profile.name}</div>
          <div className="text-sm text-muted break-words">{profile.subtitle}</div>
          <div className="text-xs text-muted mt-3 break-all">{profile.email}</div>
          <span className="inline-block mt-3 text-xs font-semibold px-2.5 py-1 rounded-full bg-brand-light text-brand">{profile.role_label}</span>
        </Card>

        <div className="lg:col-span-2 space-y-6">
          <Card hover>
            <SectionTitle title="Your details" subtitle={editable.length ? undefined : "These are institutional records. Ask the administrator to correct anything that is wrong."} />
            {details.length > 0 && (
              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 mb-5">
                <div><dt className="text-xs text-muted">Sign-in email</dt><dd className="text-sm text-ink break-all">{profile.email}</dd></div>
                {details.map(([k, v]) => (
                  <div key={k}><dt className="text-xs text-muted">{DETAIL_LABELS[k] || k}</dt><dd className="text-sm text-ink break-words">{String(v)}</dd></div>
                ))}
              </dl>
            )}
            {editable.length > 0 && (
              <form onSubmit={save} className="space-y-4 max-w-md">
                {editable.map((f) => (
                  <div key={f}>
                    <label htmlFor={`acct-${f}`} className="text-xs font-medium text-muted mb-1 block">{FIELD_LABELS[f] || f}</label>
                    <input id={`acct-${f}`} value={form[f] ?? ""} maxLength={120} onChange={(e) => setForm({ ...form, [f]: e.target.value })} className={inputClass} />
                  </div>
                ))}
                <Button disabled={saving || !dirty}>
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {saving ? "Saving…" : "Save changes"}
                </Button>
              </form>
            )}
          </Card>
          <ChangePasswordCard />
        </div>
      </div>
    </>
  );
}
