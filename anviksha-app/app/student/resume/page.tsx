"use client";

import { useEffect, useMemo, useState } from "react";
import { Reorder, motion } from "framer-motion";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { Download, Check, GripVertical, Eye, EyeOff, FileText, AlertCircle, CheckCircle2, Pencil, Plus, Trash2, ImagePlus } from "lucide-react";
import { LoadError, EmptyState } from "@/components/ui/States";
import { downloadResumePDF, downloadResumeDOCX, downloadResumePlainText } from "@/lib/fileGen";
import { api, API_BASE } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

const TEMPLATES = ["Classic", "Minimal", "ATS Friendly"];

type ResumeSection = { id: string; title: string; content: string; enabled: boolean; custom: boolean };

type EducationEntry = {
  level: string;
  institution: string;
  city: string;
  score_type: "percentage" | "cgpa";
  score: string;
  year: string;
};

const EDUCATION_LEVELS = ["PhD", "Master's Degree", "Bachelor's Degree", "Diploma", "12th Class / PUC", "10th Class / SSLC"];

const DEFAULT_EDUCATION: EducationEntry[] = [
  { level: "Bachelor's Degree", institution: "", city: "", score_type: "cgpa", score: "", year: "" },
  { level: "12th Class / PUC", institution: "", city: "", score_type: "percentage", score: "", year: "" },
  { level: "10th Class / SSLC", institution: "", city: "", score_type: "percentage", score: "", year: "" },
];

// Highest qualification first — matches the order education is conventionally listed on a resume.
const LEVEL_RANK = Object.fromEntries(EDUCATION_LEVELS.map((l, i) => [l, i]));

// The backend stores/returns score and year as numbers (or null) — this page's
// state always keeps them as strings (controlled-input friendly, and safe to
// call .trim() on), so anything loaded from the API is coerced on the way in.
function normalizeEducation(entries: any[]): EducationEntry[] {
  return entries.map((e) => ({
    level: e.level || EDUCATION_LEVELS[0],
    institution: e.institution || "",
    city: e.city || "",
    score_type: e.score_type === "cgpa" ? "cgpa" : "percentage",
    score: e.score == null ? "" : String(e.score),
    year: e.year == null ? "" : String(e.year),
  }));
}

function educationContent(entries: EducationEntry[]) {
  return [...entries]
    .filter((e) => String(e.institution || "").trim())
    .sort((a, b) => (LEVEL_RANK[a.level] ?? 99) - (LEVEL_RANK[b.level] ?? 99))
    .map((e) => {
      const score = e.score ? `${e.score}${e.score_type === "percentage" ? "%" : " CGPA"}` : null;
      const parts = [e.institution, e.city].filter(Boolean).join(", ");
      return [e.level, parts, score, e.year].filter(Boolean).join(" — ");
    })
    .join("\n");
}

function realContentFor(key: string, profile: any, achievements: any[], courses: any[], internships: any[], objective: string, education: EducationEntry[]) {
  switch (key) {
    case "objective": return objective;
    case "education": return educationContent(education);
    case "skills": return profile.skills || "";
    case "internships": return internships.map((i: any) => `${i.company} (${i.duration})`).join("; ");
    case "courses": return courses.map((c: any) => c.course_name).join(", ");
    case "achievements": return achievements.map((a: any) => a.title).join(", ");
    default: return "";
  }
}

export default function ResumePage() {
  const [profile, setProfile] = useState<any>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [courses, setCourses] = useState<any[]>([]);
  const [internships, setInternships] = useState<any[]>([]);
  const [liveMode, setLiveMode] = useState(false);
  const [template, setTemplate] = useState("ATS Friendly");
  const [objective, setObjective] = useState("");
  const [sections, setSections] = useState<ResumeSection[]>([
    { id: "education", title: "Education", content: "", enabled: true, custom: false },
    { id: "skills", title: "Skills", content: "", enabled: true, custom: false },
    { id: "internships", title: "Internships", content: "", enabled: true, custom: false },
    { id: "courses", title: "Courses", content: "", enabled: true, custom: false },
    { id: "achievements", title: "Achievements", content: "", enabled: true, custom: false },
  ]);
  const [editingSection, setEditingSection] = useState<ResumeSection | null>(null);
  const [editForm, setEditForm] = useState({ title: "", content: "" });
  const [showAddModal, setShowAddModal] = useState(false);
  const [newSection, setNewSection] = useState({ title: "", content: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState(false);
  const [contact, setContact] = useState({ email: "", phone: "", location: "" });
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [education, setEducation] = useState<EducationEntry[]>(DEFAULT_EDUCATION);
  const [showEducationModal, setShowEducationModal] = useState(false);
  const [educationDraft, setEducationDraft] = useState<EducationEntry[]>(DEFAULT_EDUCATION);
  const [savingEducation, setSavingEducation] = useState(false);
  const { push } = useToast();

  const handlePhotoUpload = async (file: File) => {
    setUploadingPhoto(true);
    try {
      const res = await api.uploadProfilePhoto(file);
      setProfile((p: any) => ({ ...p, photo_url: res.photo_url }));
      push("Profile photo updated");
    } catch (e: any) {
      push(e.message || "Photo upload failed", "error");
    }
    setUploadingPhoto(false);
  };

  const load = () => {
    setLoadError(false);
    api.studentDashboard().then((d) => {
      setProfile((p: any) => ({ ...p, ...d }));
      if (Array.isArray(d.education) && d.education.length > 0) setEducation(normalizeEducation(d.education));
      setLiveMode(true);
    }).catch(() => setLoadError(true));
    api.studentAchievements().then((a) => setAchievements(a)).catch(() => {});
    api.myCourses().then((c) => setCourses(c)).catch(() => {});
    api.myInternships().then((i) => setInternships(i)).catch(() => {});
  };
  useEffect(load, []);

  // sync auto-computed real content into predefined (non-custom) sections whenever underlying real data changes,
  // unless the student has manually overridden that section's text
  useEffect(() => {
    if (!profile) return;
    setSections((prev) => prev.map((s) => s.custom ? s : { ...s, content: s.content || realContentFor(s.id, profile, achievements, courses, internships, objective, education) }));
  }, [profile, achievements, courses, internships]);

  // Education is edited structurally (see the dedicated modal below), not as
  // free text, so its rendered content is force-synced whenever the entries change.
  useEffect(() => {
    setSections((prev) => prev.map((s) => s.id === "education" ? { ...s, content: educationContent(education) } : s));
  }, [education]);

  const activeOrder = sections.filter((s) => s.enabled);

  const atsChecks = useMemo(() => {
    if (!profile) return [];
    const skillsSection = sections.find((s) => s.id === "skills");
    const skillsWordCount = (skillsSection?.content || "").split(/[,\s]+/).filter(Boolean).length;
    return [
      { label: "Contact info present (name, USN)", pass: !!profile.name && !!profile.usn },
      { label: "Skills section has 3+ keywords", pass: skillsWordCount >= 3 },
      { label: "Education details complete", pass: education.some((e) => String(e.institution || "").trim() && String(e.score ?? "").trim()) },
      { label: "Career objective written", pass: !!objective.trim() },
      { label: "At least one section has real content", pass: activeOrder.some((s) => s.content?.trim()) },
      { label: "Using single-column, simple layout", pass: template === "ATS Friendly" || template === "Minimal" },
    ];
  }, [profile, sections, objective, template, activeOrder]);

  const atsScore = profile ? Math.round((atsChecks.filter((c) => c.pass).length / Math.max(atsChecks.length, 1)) * 100) : 0;

  const buildData = { ...profile, contactEmail: contact.email, contactPhone: contact.phone, contactLocation: contact.location };
  const buildSections = activeOrder.map((s) => ({ title: s.title, content: s.id === "objective" ? objective : s.content }));

  const openEdit = (s: ResumeSection) => {
    if (s.id === "education") { setEducationDraft(education); setShowEducationModal(true); return; }
    setEditingSection(s);
    setEditForm({ title: s.title, content: s.content });
  };
  const saveEdit = () => {
    if (!editingSection) return;
    setSections((prev) => prev.map((s) => s.id === editingSection.id ? { ...s, title: editForm.title, content: editForm.content } : s));
    setEditingSection(null);
    push("Section updated");
  };

  const addEducationRow = () => setEducationDraft((prev) => [...prev, { level: EDUCATION_LEVELS[0], institution: "", city: "", score_type: "percentage", score: "", year: "" }]);
  const updateEducationRow = (i: number, patch: Partial<EducationEntry>) =>
    setEducationDraft((prev) => prev.map((e, idx) => idx === i ? { ...e, ...patch } : e));
  const removeEducationRow = (i: number) => setEducationDraft((prev) => prev.filter((_, idx) => idx !== i));

  const saveEducation = async () => {
    setSavingEducation(true);
    const cleaned = educationDraft.map((e) => ({ ...e, score: e.score ? Number(e.score) : null, year: e.year ? Number(e.year) : null }));
    try {
      await api.updateEducation(cleaned);
      setEducation(educationDraft);
      setShowEducationModal(false);
      push("Education updated");
    } catch {
      push("Could not save your education details. Please try again.", "error");
    }
    setSavingEducation(false);
  };

  const addSection = () => {
    if (!newSection.title.trim()) { push("Section name is required", "error"); return; }
    const id = `custom-${Date.now()}`;
    setSections((prev) => [...prev, { id, title: newSection.title, content: newSection.content, enabled: true, custom: true }]);
    setNewSection({ title: "", content: "" });
    setShowAddModal(false);
    push("Section added");
  };

  const confirmDelete = () => {
    if (!deleteConfirm) return;
    setSections((prev) => prev.filter((s) => s.id !== deleteConfirm));
    setDeleteConfirm(null);
    push("Section deleted");
  };

  if (loadError && !profile) return <><Topbar greeting="Resume Builder" subtitle="Build your resume" avatarLetter="S" /><LoadError message="We couldn't load your details for the resume." onRetry={load} /></>;
  if (!profile) return <><Topbar greeting="Resume Builder" subtitle="Loading your details…" avatarLetter="S" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="Resume Builder" subtitle="Dashboard > Resume Builder" avatarLetter="S" />
      <div className="p-4 md:p-8 grid lg:grid-cols-3 gap-6">
        <Card hover>
          <SectionTitle title="1. Select Template" />
          <div className="space-y-3">
            {TEMPLATES.map((t) => (
              <button key={t} onClick={() => setTemplate(t)} className={`w-full text-left border-2 rounded-xl p-3 flex items-center gap-3 transition-colors ${template === t ? "border-brand bg-brand-light" : "border-gray-100 hover:border-gray-200"}`}>
                <div className="w-10 h-14 bg-white border border-gray-200 rounded shrink-0 flex flex-col p-1 gap-0.5">
                  <div className={`h-1 rounded-full w-3/4 ${t === "ATS Friendly" ? "bg-gray-800" : t === "Minimal" ? "bg-gray-400" : "bg-brand"}`} />
                  <div className="h-0.5 bg-gray-200 rounded-full w-full mt-1" />
                  <div className="h-0.5 bg-gray-200 rounded-full w-full" />
                  <div className="h-0.5 bg-gray-200 rounded-full w-2/3" />
                </div>
                <span className="text-sm font-medium text-ink">{t}</span>
                {template === t && <Check size={16} className="text-brand ml-auto" />}
              </button>
            ))}
          </div>

          <div className="mt-5 p-3 rounded-xl bg-success/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-success">Real ATS Compatibility Score</span>
              <span className="text-lg font-extrabold font-display text-success numeric">{atsScore}%</span>
            </div>
            <div className="space-y-1.5">
              {atsChecks.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 text-xs">
                  {c.pass ? <CheckCircle2 size={13} className="text-success shrink-0" /> : <AlertCircle size={13} className="text-warning shrink-0" />}
                  <span className={c.pass ? "text-ink" : "text-muted"}>{c.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-ink">Contact Details (for resume only)</span>
              <button onClick={() => setEditingContact(!editingContact)} className="text-brand"><Pencil size={13} /></button>
            </div>
            {editingContact ? (
              <div className="space-y-2">
                <input value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="Email for resume" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none" />
                <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="Phone for resume" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none" />
                <input value={contact.location} onChange={(e) => setContact({ ...contact, location: e.target.value })} placeholder="City, State" className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs outline-none" />
              </div>
            ) : (
              <p className="text-xs text-muted">{contact.email || contact.phone || contact.location ? `${contact.email} ${contact.phone} ${contact.location}` : "Not added yet — click pencil to add"}</p>
            )}
          </div>
        </Card>

        <Card hover>
          <SectionTitle title="2. Sections" subtitle="Edit, reorder, add, or remove — fully customizable" />
          <div className="mb-3">
            <label className="text-xs font-medium text-muted mb-1 block">Career Objective</label>
            <textarea value={objective} onChange={(e) => setObjective(e.target.value)} rows={2} placeholder="e.g. Aspiring software engineer seeking..." className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <Reorder.Group axis="y" values={sections} onReorder={setSections} className="space-y-2">
            {sections.map((s) => (
              <Reorder.Item key={s.id} value={s} className="flex items-center gap-2 bg-gray-50 rounded-xl p-3 cursor-grab active:cursor-grabbing" whileDrag={{ scale: 1.03, boxShadow: "0 8px 24px rgba(15,18,41,0.12)" }}>
                <GripVertical size={15} className="text-muted shrink-0" />
                <span className={`text-sm flex-1 ${s.enabled ? "text-ink font-medium" : "text-muted line-through"}`}>
                  {s.title}{s.custom && <Badge tone="brand" className="ml-2 !py-0.5">Custom</Badge>}
                </span>
                <button onClick={() => openEdit(s)} className="text-muted hover:text-brand p-1"><Pencil size={14} /></button>
                <button onClick={() => setSections((prev) => prev.map((x) => x.id === s.id ? { ...x, enabled: !x.enabled } : x))} className="text-muted hover:text-brand p-1">
                  {s.enabled ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
                {s.custom && (
                  <button onClick={() => setDeleteConfirm(s.id)} className="text-muted hover:text-danger p-1"><Trash2 size={14} /></button>
                )}
              </Reorder.Item>
            ))}
          </Reorder.Group>

          <Button variant="secondary" className="w-full mt-3" onClick={() => setShowAddModal(true)}><Plus size={14} /> Add New Section</Button>

          <div className="flex gap-2 mt-5">
            <Button className="flex-1" onClick={() => { downloadResumePDF(buildData, buildSections, template); push("Resume PDF downloaded"); }}><Download size={14} /> PDF</Button>
            <Button variant="secondary" className="flex-1" onClick={() => { downloadResumeDOCX(buildData, buildSections); push("Resume DOCX downloaded"); }}><Download size={14} /> DOCX</Button>
          </div>
          <Button variant="secondary" className="w-full mt-2" onClick={() => { downloadResumePlainText(buildData, buildSections); push("ATS-safe plain text downloaded"); }}>
            <FileText size={14} /> Plain Text (safest for automated ATS portals)
          </Button>
        </Card>

        <Card hover className="!p-0 overflow-hidden">
          <div className="bg-gray-50 px-5 py-2.5 text-xs font-semibold text-muted border-b border-gray-100 flex items-center justify-between">
            Preview — {template}
            <Badge tone="brand">{activeOrder.length} sections</Badge>
          </div>
          <motion.div layout className="p-6 text-xs space-y-3">
            <div className="text-center border-b border-gray-100 pb-3">
              <label className="relative w-20 h-20 rounded-full mx-auto mb-2 cursor-pointer group block">
                {profile.photo_url ? (
                  <img src={`${API_BASE}${profile.photo_url}`} className="w-20 h-20 rounded-full object-cover border-2 border-brand/30" />
                ) : (
                  <div className="w-20 h-20 rounded-full bg-brand-light flex items-center justify-center border-2 border-dashed border-brand/30">
                    <ImagePlus size={20} className="text-brand" />
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <span className="text-white text-[9px] font-medium">{uploadingPhoto ? "..." : "Change"}</span>
                </div>
                <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => e.target.files?.[0] && handlePhotoUpload(e.target.files[0])} />
              </label>
              <div className="font-bold text-sm text-ink">{(profile.name || "").toUpperCase()}</div>
              <div className="text-muted mt-0.5">{profile.usn} | {profile.dept}</div>
              {(contact.email || contact.phone || contact.location) && <div className="text-muted text-[10px] mt-0.5">{contact.email} {contact.phone} {contact.location}</div>}
            </div>
            {objective && (
              <motion.div layout>
                <div className="font-semibold text-ink mb-1">CAREER OBJECTIVE</div>
                <div className="text-muted">{objective}</div>
              </motion.div>
            )}
            {activeOrder.map((s) => (
              <motion.div key={s.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <div className="font-semibold text-ink mb-1">{s.title.toUpperCase()}</div>
                <div className="text-muted whitespace-pre-wrap">{s.content?.trim() || <span className="italic">Not specified</span>}</div>
              </motion.div>
            ))}
          </motion.div>
        </Card>
      </div>

      <CenterModal open={showEducationModal} onClose={() => setShowEducationModal(false)} title="Education" width="max-w-2xl">
        <div className="space-y-4">
          <p className="text-xs text-muted">Add every qualification you'd like on your resume — highest degree, 12th, and 10th, plus anything else like a diploma.</p>
          {educationDraft.map((e, i) => (
            <div key={i} className="border border-gray-100 rounded-xl p-3.5 space-y-2.5 relative">
              {educationDraft.length > 1 && (
                <button onClick={() => removeEducationRow(i)} className="absolute top-2.5 right-2.5 text-muted hover:text-danger p-1"><Trash2 size={14} /></button>
              )}
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Level</label>
                  <select value={e.level} onChange={(ev) => updateEducationRow(i, { level: ev.target.value })} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none">
                    {EDUCATION_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{lvl}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Year of Passing</label>
                  <input type="number" value={e.year} onChange={(ev) => updateEducationRow(i, { year: ev.target.value })} placeholder="2022" className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none" />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">School / College Name</label>
                <input value={e.institution} onChange={(ev) => updateEducationRow(i, { institution: ev.target.value })} placeholder="e.g. Global Academy of Technology" className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">City</label>
                  <input value={e.city} onChange={(ev) => updateEducationRow(i, { city: ev.target.value })} placeholder="e.g. Bengaluru" className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted mb-1 block">Percentage / CGPA</label>
                  <div className="flex gap-1.5">
                    <select value={e.score_type} onChange={(ev) => updateEducationRow(i, { score_type: ev.target.value as "percentage" | "cgpa" })} className="border border-gray-200 rounded-lg px-2 py-2 text-sm outline-none">
                      <option value="percentage">%</option>
                      <option value="cgpa">CGPA</option>
                    </select>
                    <input type="number" step="0.01" value={e.score} onChange={(ev) => updateEducationRow(i, { score: ev.target.value })} placeholder={e.score_type === "cgpa" ? "9.1" : "92"} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm outline-none" />
                  </div>
                </div>
              </div>
            </div>
          ))}
          <Button variant="secondary" className="w-full" onClick={addEducationRow}><Plus size={14} /> Add Education</Button>
          <Button className="w-full" onClick={saveEducation} disabled={savingEducation}>{savingEducation ? "Saving..." : "Save Education"}</Button>
        </div>
      </CenterModal>

      <CenterModal open={!!editingSection} onClose={() => setEditingSection(null)} title={`Edit — ${editingSection?.title || ""}`}>
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Section Title</label>
            <input value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Section Content</label>
            <textarea value={editForm.content} onChange={(e) => setEditForm({ ...editForm, content: e.target.value })} rows={5} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditingSection(null)}>Cancel</Button>
            <Button className="flex-1" onClick={saveEdit}>Save</Button>
          </div>
        </div>
      </CenterModal>

      <CenterModal open={showAddModal} onClose={() => setShowAddModal(false)} title="Add New Section">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Section Name</label>
            <input value={newSection.title} onChange={(e) => setNewSection({ ...newSection, title: e.target.value })} placeholder="e.g. Certifications, Languages, Volunteer Experience" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Section Content</label>
            <textarea value={newSection.content} onChange={(e) => setNewSection({ ...newSection, content: e.target.value })} rows={4} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button className="flex-1" onClick={addSection}>Add Section</Button>
          </div>
        </div>
      </CenterModal>

      <CenterModal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Delete Section">
        <div className="space-y-4">
          <p className="text-sm text-ink">Are you sure you want to delete this section?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={confirmDelete}>Delete</Button>
          </div>
        </div>
      </CenterModal>
    </>
  );
}
