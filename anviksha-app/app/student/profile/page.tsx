"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button } from "@/components/ui/Primitives";
import { Drawer } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { Edit3, CheckCircle2, XCircle, Camera, Loader2, FileUp, Trash2 } from "lucide-react";
import { LoadError, EmptyState } from "@/components/ui/States";
import { api, API_BASE } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { FileCheck, Download } from "lucide-react";
import { ChangePasswordCard } from "@/components/account/AccountPage";
import { refreshProfile } from "@/lib/useProfile";

function CompletionRing({ value }: { value: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative w-32 h-32 mx-auto">
      <svg width="128" height="128" className="-rotate-90">
        <circle cx="64" cy="64" r={r} stroke="#F0F0F5" strokeWidth="10" fill="none" />
        <motion.circle
          cx="64" cy="64" r={r} stroke="#5B3FD9" strokeWidth="10" fill="none" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c - (value / 100) * c }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-extrabold font-display text-ink">{value}%</span>
        <span className="text-xs text-muted">Complete</span>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<any>(null);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [liveMode, setLiveMode] = useState(false);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ linkedin: "", github: "", skills: "" });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingResume, setUploadingResume] = useState(false);
  const { push } = useToast();

  const [loadError, setLoadError] = useState(false);
  const load = () => {
    setLoadError(false);
    api.studentDashboard()
      .then((d) => {
        setProfile(d);
        setForm({ linkedin: d.linkedin || "", github: d.github || "", skills: d.skills || "" });
        setLiveMode(true);
      })
      .catch(() => { setLiveMode(false); setLoadError(true); });
    api.myCertificates().then(setCertificates).catch(() => {});
  };
  useEffect(load, []);

  const handlePhotoUpload = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const res = await api.uploadAccountPhoto(file);
      setProfile((p: any) => ({ ...p, photo_url: res.photo_url }));
      refreshProfile();   // so the header and sidebar show the new photo straight away
      push("Profile photo updated");
    } catch (e: any) {
      push(e.message || "Photo upload failed", "error");
    }
    setUploadingPhoto(false);
  };

  const handleResumeUpload = async (file: File) => {
    setUploadingResume(true);
    try {
      const res = await api.uploadResumeFile(file);
      setProfile((p: any) => ({ ...p, resume_file_url: res.resume_file_url }));
      push("Resume uploaded");
    } catch (e: any) {
      push(e.message || "Resume upload failed", "error");
    }
    setUploadingResume(false);
  };

  const handleResumeDelete = async () => {
    try {
      await api.deleteResumeFile();
      setProfile((p: any) => ({ ...p, resume_file_url: null }));
      push("Resume removed");
    } catch {
      push("Failed to remove resume", "error");
    }
  };

  if (loadError && !profile) return <><Topbar greeting="My Profile" subtitle="Your details" avatarLetter="S" /><LoadError message="We couldn't load your profile." onRetry={load} /></>;
  if (!profile) return <><Topbar greeting="My Profile" subtitle="Loading your profile…" avatarLetter="S" /><DashboardSkeleton /></>;

  // Real completion checklist — based on what's actually filled in, not hardcoded true/false
  const checklist = [
    { label: "Basic Information", done: !!profile.name && !!profile.usn },
    { label: "Academic Details", done: profile.cgpa != null },
    { label: "Skills", done: !!profile.skills },
    { label: "LinkedIn", done: !!profile.linkedin },
    { label: "GitHub", done: !!profile.github },
    { label: "Resume", done: !!profile.resume_link || !!profile.resume_file_url },
  ];
  const completion = Math.round((checklist.filter((c) => c.done).length / checklist.length) * 100);

  return (
    <>
      <Topbar greeting="My Profile" subtitle="Dashboard > My Profile" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}><Edit3 size={15} /> Edit Profile</Button>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-1 text-center" hover>
            <label className="relative w-20 h-20 mx-auto mb-3 block cursor-pointer group">
              {profile.photo_url ? (
                <img src={`${API_BASE}${profile.photo_url}`} className="w-20 h-20 rounded-full object-cover border-2 border-brand/30" />
              ) : (
                <div className="w-20 h-20 rounded-full bg-brand text-white text-2xl font-bold flex items-center justify-center">
                  {profile.name?.charAt(0)}
                </div>
              )}
              <div className="absolute inset-0 rounded-full bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                {uploadingPhoto ? <Loader2 size={16} className="text-white animate-spin" /> : <Camera size={16} className="text-white" />}
              </div>
              <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])} />
            </label>
            <h3 className="font-semibold text-lg text-ink">{profile.name}</h3>
            <p className="text-sm text-muted">{profile.usn} | {profile.batch ? `Batch ${profile.batch}` : ""}</p>
          </Card>

          <Card className="lg:col-span-2" hover>
            <SectionTitle title="Academic Information" />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-muted text-xs mb-1">Status</div><div className="font-medium text-ink capitalize">{profile.status?.replace("_", " ")}</div></div>
              <div><div className="text-muted text-xs mb-1">Semester</div><div className="font-medium text-ink">{profile.semester ?? "N/A"}</div></div>
              <div><div className="text-muted text-xs mb-1">CGPA</div><div className="font-medium text-ink">{profile.cgpa ?? "N/A"}</div></div>
              <div><div className="text-muted text-xs mb-1">Backlogs</div><div className="font-medium text-ink">{profile.backlogs ?? 0}</div></div>
            </div>
            <div className="border-t border-gray-100 my-5" />
            <SectionTitle title="Professional Information" />
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><div className="text-muted text-xs mb-1">LinkedIn</div><div className="font-medium text-brand truncate">{profile.linkedin || "Not added"}</div></div>
              <div><div className="text-muted text-xs mb-1">GitHub</div><div className="font-medium text-brand truncate">{profile.github || "Not added"}</div></div>
              <div className="col-span-2"><div className="text-muted text-xs mb-1">Skills</div><div className="font-medium text-ink">{profile.skills || "Not added yet"}</div></div>
            </div>
          </Card>
        </div>

        <Card hover>
          <SectionTitle title="Profile Completion" />
          <div className="grid md:grid-cols-2 gap-6 items-center">
            <CompletionRing value={completion} />
            <div className="space-y-2">
              {checklist.map((c) => (
                <div key={c.label} className="flex items-center gap-2 text-sm">
                  {c.done ? <CheckCircle2 size={16} className="text-success" /> : <XCircle size={16} className="text-danger" />}
                  <span className={c.done ? "text-ink" : "text-muted"}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card hover>
          <SectionTitle title="Resume" subtitle="Upload a PDF or Word document" />
          {profile.resume_file_url ? (
            <div className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 bg-brand-light/30">
              <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center shrink-0">
                <FileCheck size={18} className="text-brand" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink truncate">Resume on file</div>
                <div className="text-xs text-muted truncate">{profile.resume_file_url.split("/").pop()}</div>
              </div>
              <a href={`${API_BASE}${profile.resume_file_url}`} target="_blank" rel="noreferrer" className="text-muted hover:text-brand p-2 rounded-lg hover:bg-white transition-colors"><Download size={16} /></a>
              <button onClick={handleResumeDelete} className="text-muted hover:text-danger p-2 rounded-lg hover:bg-white transition-colors"><Trash2 size={16} /></button>
              <label className="cursor-pointer text-xs font-semibold text-brand px-3 py-2 rounded-lg hover:bg-white transition-colors">
                {uploadingResume ? "..." : "Replace"}
                <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && handleResumeUpload(e.target.files[0])} />
              </label>
            </div>
          ) : (
            <label className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl border-2 border-dashed border-gray-200 hover:border-brand/40 hover:bg-brand-light/20 transition-colors cursor-pointer">
              {uploadingResume ? <Loader2 size={22} className="text-brand animate-spin" /> : <FileUp size={22} className="text-muted" />}
              <span className="text-sm font-medium text-ink">{uploadingResume ? "Uploading..." : "Click to upload your resume"}</span>
              <span className="text-xs text-muted">PDF, DOC, or DOCX — max 10MB</span>
              <input type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && handleResumeUpload(e.target.files[0])} />
            </label>
          )}
        </Card>

        <Card hover>
          <SectionTitle title="Certificates" subtitle={certificates.length > 0 ? `${certificates.length} verified certificate(s) on file` : undefined} />
          {certificates.length === 0 ? (
            <p className="text-sm text-muted text-center py-6">No verified certificates on file yet.</p>
          ) : (
            <div className="grid md:grid-cols-2 gap-3">
              {certificates.map((c: any) => (
                <a key={c.id} href={`${API_BASE}${c.download_url}`} target="_blank" rel="noreferrer" className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-brand/40 hover:bg-brand-light/40 transition-colors group">
                  <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center shrink-0">
                    <FileCheck size={18} className="text-brand" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{c.label}</div>
                    <div className="text-xs text-muted truncate">{c.filename}</div>
                  </div>
                  <Download size={15} className="text-muted group-hover:text-brand transition-colors shrink-0" />
                </a>
              ))}
            </div>
          )}
        </Card>
        <ChangePasswordCard />
      </div>

      <Drawer open={open} onClose={() => setOpen(false)} title="Edit Profile">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">LinkedIn URL</label>
            <input value={form.linkedin} onChange={(e) => setForm({ ...form, linkedin: e.target.value })} placeholder="https://linkedin.com/in/..." className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">GitHub URL</label>
            <input value={form.github} onChange={(e) => setForm({ ...form, github: e.target.value })} placeholder="https://github.com/..." className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Skills (comma-separated)</label>
            <textarea value={form.skills} onChange={(e) => setForm({ ...form, skills: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <Button className="w-full mt-2" onClick={async () => {
            if (!form.linkedin && !form.github && !form.skills) {
              push("Add at least one field before saving", "error");
              return;
            }
            try {
              const updated = await api.updateProfile(form);
              setProfile((p: any) => ({ ...p, ...updated }));
              push("Profile saved");
              setOpen(false);
            } catch {
              push("Could not save your profile. Please try again.", "error");
            }
          }}>Save Changes</Button>
        </div>
      </Drawer>
    </>
  );
}
