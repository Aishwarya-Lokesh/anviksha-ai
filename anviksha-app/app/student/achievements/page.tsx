"use client";

import { useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Button, Badge } from "@/components/ui/Primitives";
import { Tabs } from "@/components/ui/Tabs";
import { CenterModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Trophy, Award, Briefcase, Users, Inbox, Eye, Upload, Trash2, X, ImagePlus, Loader2 } from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

const TABS = ["All", "Hackathon", "Certificate", "Project", "Activity"];
const iconFor: Record<string, any> = { Hackathon: Trophy, Certificate: Award, Project: Briefcase, Activity: Users };
const EMPTY_MSG: Record<string, string> = {
  Hackathon: "No hackathons added yet.", Certificate: "No certificates added yet.",
  Project: "No projects added yet.", Activity: "No activities added yet.", All: "No achievements found",
};

export default function AchievementsPage() {
  const [tab, setTab] = useState("All");
  const [items, setItems] = useState<any[] | null>(null);
  const [certificates, setCertificates] = useState<any[]>([]);
  const [liveMode, setLiveMode] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState("Hackathon");
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", year: "", description: "", domain: "", tools: "", tech: "", won: false });
  const [certFile, setCertFile] = useState<File | null>(null);
  const [projectImages, setProjectImages] = useState<File[]>([]);

  const [viewing, setViewing] = useState<any>(null);
  const [reuploadTarget, setReuploadTarget] = useState<any>(null);
  const [reuploadFile, setReuploadFile] = useState<File | null>(null);
  const [reuploadImages, setReuploadImages] = useState<File[]>([]);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [projectEditForm, setProjectEditForm] = useState({ title: "", description: "", domain: "", tools: "", tech: "" });
  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [legacyEditing, setLegacyEditing] = useState<any>(null);
  const [legacyLabel, setLegacyLabel] = useState("");
  const [legacyFile, setLegacyFile] = useState<File | null>(null);
  const certInputRef = useRef<HTMLInputElement>(null);
  const { push } = useToast();

  const load = () => {
    Promise.all([api.studentAchievements(), api.myCertificates().catch(() => [])])
      .then(([a, c]) => { setItems(a); setCertificates(c); setLiveMode(true); })
      .catch(() => setLoadError(true));
  };
  useEffect(() => { load(); }, []);

  // Real/demo certificate files (from the earlier verified/demo import) merged in
  // alongside student-added achievements, so nothing from before is lost.
  const certAsItems = certificates.map((c: any) => ({
    id: `cert-${c.id}`, title: c.label || "Certificate", description: c.filename,
    type: c.category || "Certificate", year: null,
    certificate_url: c.download_url, certificate_type: c.is_demo ? "ai_generated_demo" : "verified",
    isLegacyFile: true, isDemo: c.is_demo,
  }));

  const filtered = tab === "All" ? [...(items || []), ...certAsItems] : [...(items || []), ...certAsItems].filter((a) => a.type === tab);

  const resetAddForm = () => {
    setForm({ title: "", year: "", description: "", domain: "", tools: "", tech: "", won: false });
    setCertFile(null);
    setProjectImages([]);
  };

  const openAdd = () => {
    setAddType(tab === "All" ? "Hackathon" : tab);
    resetAddForm();
    setShowAdd(true);
  };

  const submitAdd = async () => {
    if (!form.title.trim()) { push("Name is required", "error"); return; }
    if (addType === "Project" && (!form.domain.trim() || !form.tools.trim() || !form.tech.trim() || !form.description.trim())) {
      push("Domain, Tools Used, Technologies Used, and Description are all required for a project", "error");
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append("title", form.title);
      fd.append("type", addType);
      if (form.year) fd.append("year", form.year);
      fd.append("description", form.description);
      if (addType === "Hackathon") fd.append("won", String(form.won));
      if (addType === "Project") {
        fd.append("domain", form.domain);
        fd.append("tools_used", form.tools);
        fd.append("technologies_used", form.tech);
        projectImages.forEach((img) => fd.append("images", img));
      } else if (certFile) {
        fd.append("certificate", certFile);
      }
      await api.addAchievement(fd);
      push(`${addType} added successfully`);
      setShowAdd(false);
      load();
    } catch (e: any) {
      push(e.message || "Could not add this. Please try again.", "error");
    }
    setSaving(false);
  };

  const openProjectEdit = (a: any) => {
    setEditingProject(a);
    setProjectEditForm({ title: a.title, description: a.description, domain: a.domain || "", tools: (a.tools_used || []).join(","), tech: (a.technologies_used || []).join(",") });
  };

  const saveProjectEdit = async () => {
    if (!editingProject) return;
    try {
      await api.editAchievement(editingProject.id, {
        title: projectEditForm.title, description: projectEditForm.description,
        domain: projectEditForm.domain, tools_used: projectEditForm.tools, technologies_used: projectEditForm.tech,
      });
      push("Project updated");
      setEditingProject(null);
      load();
    } catch (e: any) {
      push(e.message || "Update failed", "error");
    }
  };

  const submitReupload = async () => {
    if (!reuploadTarget) return;
    try {
      const fd = new FormData();
      if (reuploadTarget.type === "Project") {
        reuploadImages.forEach((img) => fd.append("images", img));
      } else if (reuploadFile) {
        fd.append("certificate", reuploadFile);
      } else {
        push("Choose a file first", "error");
        return;
      }
      await api.reuploadAchievementFile(reuploadTarget.id, fd);
      push("File updated successfully");
      setReuploadTarget(null);
      setReuploadFile(null);
      setReuploadImages([]);
      load();
    } catch (e: any) {
      push(e.message || "Re-upload failed", "error");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.isLegacyFile) {
        const certId = Number(String(deleteTarget.id).replace("cert-", ""));
        await api.deleteCertificate(certId);
      } else {
        await api.deleteAchievement(deleteTarget.id);
      }
      push("Deleted");
      setDeleteTarget(null);
      load();
    } catch {
      push("Delete failed", "error");
    }
  };

  const saveLegacyEdit = async () => {
    if (!legacyEditing) return;
    const certId = Number(String(legacyEditing.id).replace("cert-", ""));
    try {
      if (legacyFile) {
        const fd = new FormData();
        fd.append("file", legacyFile);
        fd.append("label", legacyLabel);
        fd.append("certificate_id", String(certId));
        await api.uploadCertificate(legacyFile, legacyLabel, certId);
      } else {
        await api.updateCertificateLabel(certId, legacyLabel);
      }
      push("Certificate updated successfully.");
      setLegacyEditing(null);
      setLegacyFile(null);
      load();
    } catch {
      push("Update failed", "error");
    }
  };

  if (items === null && !loadError) {
    return <><Topbar greeting="My Achievements" subtitle="Loading achievements..." avatarLetter="S" /><DashboardSkeleton /></>;
  }
  if (loadError) {
    return <><Topbar greeting="My Achievements" subtitle="Unable to load achievements. Please try again." avatarLetter="S" /><div className="p-4 md:p-8 text-sm text-danger">Unable to load achievements. Please try again.</div></>;
  }

  return (
    <>
      <Topbar greeting="My Achievements" subtitle="Dashboard > Achievements" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <Button onClick={openAdd}><Plus size={15} /> Add Achievement</Button>
        </div>

        {filtered.length === 0 && (
          <Card className="text-center py-10" hover>
            <Inbox size={28} className="text-muted mx-auto mb-2 opacity-50" />
            <p className="text-sm text-muted">{EMPTY_MSG[tab]}</p>
          </Card>
        )}

        <div className="grid md:grid-cols-3 gap-5">
          <AnimatePresence mode="popLayout">
            {filtered.map((a: any, i: number) => {
              const Icon = iconFor[a.type] || Trophy;
              const isProject = a.type === "Project";
              return (
                <motion.div key={a.id} layout initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ delay: i * 0.05 }} whileHover={{ y: -4 }}>
                  <div className="relative bg-gradient-to-br from-white to-brand-light/40 rounded-2xl border-2 border-brand/15 shadow-card hover:shadow-cardHover transition-shadow p-5 overflow-hidden">
                    <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-brand/30 rounded-tl-2xl" />
                    <div className="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-brand/30 rounded-tr-2xl" />
                    <div className="text-center pt-2">
                      {isProject && a.images?.[0] ? (
                        <img src={`${API_BASE}${a.images[0]}`} className="w-20 h-20 rounded-xl object-cover mx-auto mb-3 border-2 border-brand/30" />
                      ) : (
                        <div className="w-14 h-14 rounded-full bg-white border-2 border-brand/30 flex items-center justify-center mx-auto mb-3 shadow-sm relative">
                          <Icon size={24} className="text-brand" />
                          {a.certificate_type === "ai_generated_demo" && <span className="absolute -top-1 -right-1 bg-warning text-white text-[7px] font-bold px-1 py-0.5 rounded-full">{a.isDemo ? "DEMO" : "AI"}</span>}
                        </div>
                      )}
                      <div className="text-[10px] uppercase tracking-wider text-brand/70 font-semibold mb-1">{isProject ? a.domain || "Project" : `Certificate of ${a.type}`}</div>
                      <h4 className="font-bold text-ink mb-1.5 font-display">{a.title}</h4>
                      <p className="text-xs text-muted mb-3 leading-relaxed px-2 line-clamp-2">{a.description || (a.year ? `Year: ${a.year}` : "")}</p>
                      {isProject && (
                        <div className="flex flex-wrap gap-1 justify-center mb-3">
                          {(a.technologies_used || []).slice(0, 3).map((t: string) => <Badge key={t} tone="info">{t}</Badge>)}
                        </div>
                      )}
                      <div className="border-t border-dashed border-brand/20 pt-3 flex flex-col items-center gap-2">
                        {a.year && !isProject && <span className="text-xs text-muted">{a.year}</span>}
                        <div className="flex gap-1.5 w-full">
                          <button onClick={() => setViewing(a)} className="flex-1 text-xs bg-brand-light text-brand font-semibold px-2 py-1.5 rounded-lg hover:bg-brand/20 transition-colors flex items-center justify-center gap-1">
                            <Eye size={12} /> View
                          </button>
                          {isProject ? (
                            <button onClick={() => openProjectEdit(a)} className="flex-1 text-xs bg-gray-100 text-ink font-semibold px-2 py-1.5 rounded-lg hover:bg-gray-200 transition-colors">Edit</button>
                          ) : (
                            <button onClick={() => { if (a.isLegacyFile) { setLegacyEditing(a); setLegacyLabel(a.title); } else { setReuploadTarget(a); } }} className="flex-1 text-xs bg-gray-100 text-ink font-semibold px-2 py-1.5 rounded-lg hover:bg-gray-200 transition-colors flex items-center justify-center gap-1">
                              <Upload size={12} /> Edit
                            </button>
                          )}
                          <button onClick={() => setDeleteTarget(a)} className="text-xs bg-danger/10 text-danger font-semibold px-2 py-1.5 rounded-lg hover:bg-danger/20 transition-colors"><Trash2 size={12} /></button>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      </div>

      {/* Add Achievement modal — form varies by type */}
      <CenterModal open={showAdd} onClose={() => setShowAdd(false)} title={`Add ${addType}`}>
        <div className="space-y-4">
          {tab === "All" && (
            <div>
              <label className="text-xs font-medium text-muted mb-1 block">Type</label>
              <select value={addType} onChange={(e) => setAddType(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none">
                {TABS.slice(1).map((t) => <option key={t}>{t}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">{addType === "Project" ? "Project Name" : `${addType} Name`} <span className="text-danger">*</span></label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>

          {addType === "Project" ? (
            <>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Domain <span className="text-danger">*</span></label>
                <input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="e.g. AI/ML, Web Development, IoT" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Tools Used <span className="text-danger">*</span></label>
                <input value={form.tools} onChange={(e) => setForm({ ...form, tools: e.target.value })} placeholder="VS Code, GitHub, Figma" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Technologies Used <span className="text-danger">*</span></label>
                <input value={form.tech} onChange={(e) => setForm({ ...form, tech: e.target.value })} placeholder="React, Python, Flask, MySQL" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Description <span className="text-danger">*</span></label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Project Images (optional)</label>
                <input type="file" accept=".jpg,.jpeg,.png,.webp" multiple onChange={(e) => setProjectImages(Array.from(e.target.files || []))} className="w-full text-xs" />
                {projectImages.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {projectImages.map((img, i) => (
                      <div key={i} className="relative">
                        <img src={URL.createObjectURL(img)} className="w-14 h-14 rounded-lg object-cover border border-gray-200" />
                        <button onClick={() => setProjectImages(projectImages.filter((_, idx) => idx !== i))} className="absolute -top-1.5 -right-1.5 bg-danger text-white rounded-full w-4 h-4 flex items-center justify-center"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Year of Completion</label>
                <input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} placeholder="2026" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
              {addType === "Hackathon" && (
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.won} onChange={(e) => setForm({ ...form, won: e.target.checked })} className="w-4 h-4 accent-brand" />
                  I won this hackathon <span className="text-[10px] text-muted">(+100 bonus points)</span>
                </label>
              )}
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Description</label>
                <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-muted mb-1 block">Upload {addType === "Activity" ? "Proof/" : ""}Certificate</label>
                <input ref={certInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setCertFile(e.target.files?.[0] || null)} className="w-full text-xs" />
                {certFile && <p className="text-xs text-success mt-1">Selected: {certFile.name}</p>}
                <p className="text-[10px] text-muted mt-1">Demo mode — accepted as an AI-generated certificate, no verification performed yet.</p>
              </div>
            </>
          )}
          <Button className="w-full" onClick={submitAdd} disabled={saving}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : `Add ${addType}`}
          </Button>
        </div>
      </CenterModal>

      {/* View modal */}
      <CenterModal open={!!viewing} onClose={() => setViewing(null)} title={viewing?.title || ""}>
        {viewing && (
          <div className="space-y-3">
            {viewing.type === "Project" ? (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div><div className="text-xs text-muted">Domain</div><div className="font-medium">{viewing.domain}</div></div>
                </div>
                <div><div className="text-xs text-muted mb-1">Tools Used</div><div className="flex flex-wrap gap-1">{(viewing.tools_used || []).map((t: string) => <Badge key={t} tone="neutral">{t}</Badge>)}</div></div>
                <div><div className="text-xs text-muted mb-1">Technologies Used</div><div className="flex flex-wrap gap-1">{(viewing.technologies_used || []).map((t: string) => <Badge key={t} tone="info">{t}</Badge>)}</div></div>
                <div><div className="text-xs text-muted mb-1">Description</div><p className="text-sm text-ink">{viewing.description}</p></div>
                {viewing.images?.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {viewing.images.map((img: string, i: number) => <img key={i} src={`${API_BASE}${img}`} className="rounded-xl w-full object-cover" />)}
                  </div>
                )}
              </>
            ) : viewing.certificate_url ? (
              viewing.certificate_url.toLowerCase().endsWith(".pdf") ? (
                <iframe src={`${API_BASE}${viewing.certificate_url}`} className="w-full h-96 rounded-xl border border-gray-200" />
              ) : (
                <img src={`${API_BASE}${viewing.certificate_url}`} className="w-full rounded-xl border border-gray-200" />
              )
            ) : (
              <p className="text-sm text-muted text-center py-8">No certificate file on this record.</p>
            )}
          </div>
        )}
      </CenterModal>

      {/* Re-upload modal for Hackathon/Certificate/Activity */}
      <CenterModal open={!!reuploadTarget} onClose={() => { setReuploadTarget(null); setReuploadFile(null); }} title={`Edit — ${reuploadTarget?.title || ""}`}>
        <div className="space-y-4">
          <p className="text-xs text-muted">Name and year can't be changed after creation — you can replace the certificate file below.</p>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Upload New Certificate</label>
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setReuploadFile(e.target.files?.[0] || null)} className="w-full text-xs" />
            {reuploadFile && <p className="text-xs text-success mt-1">Selected: {reuploadFile.name}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setReuploadTarget(null)}>Cancel</Button>
            <Button className="flex-1" onClick={submitReupload}>Save Changes</Button>
          </div>
        </div>
      </CenterModal>

      {/* Edit modal for Project — full fields */}
      <CenterModal open={!!editingProject} onClose={() => setEditingProject(null)} title="Edit Project">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Project Name</label>
            <input value={projectEditForm.title} onChange={(e) => setProjectEditForm({ ...projectEditForm, title: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Domain</label>
            <input value={projectEditForm.domain} onChange={(e) => setProjectEditForm({ ...projectEditForm, domain: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Tools Used</label>
            <input value={projectEditForm.tools} onChange={(e) => setProjectEditForm({ ...projectEditForm, tools: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Technologies Used</label>
            <input value={projectEditForm.tech} onChange={(e) => setProjectEditForm({ ...projectEditForm, tech: e.target.value })} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Description</label>
            <textarea value={projectEditForm.description} onChange={(e) => setProjectEditForm({ ...projectEditForm, description: e.target.value })} rows={3} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Replace Images (optional)</label>
            <input type="file" accept=".jpg,.jpeg,.png,.webp" multiple onChange={(e) => setReuploadImages(Array.from(e.target.files || []))} className="w-full text-xs" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditingProject(null)}>Cancel</Button>
            <Button className="flex-1" onClick={async () => {
              await saveProjectEdit();
              if (reuploadImages.length > 0 && editingProject) {
                const fd = new FormData();
                reuploadImages.forEach((img) => fd.append("images", img));
                try { await api.reuploadAchievementFile(editingProject.id, fd); push("Images updated"); load(); } catch { push("Image update failed", "error"); }
                setReuploadImages([]);
              }
            }}>Save Changes</Button>
          </div>
        </div>
      </CenterModal>

      {/* Edit modal for legacy real/demo certificate files */}
      <CenterModal open={!!legacyEditing} onClose={() => { setLegacyEditing(null); setLegacyFile(null); }} title="Edit / Re-upload Certificate">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Certificate Name</label>
            <input value={legacyLabel} onChange={(e) => setLegacyLabel(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Upload New File (optional)</label>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(e) => setLegacyFile(e.target.files?.[0] || null)} className="w-full text-xs" />
            {legacyFile && <p className="text-xs text-success mt-1">Selected: {legacyFile.name}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => { setLegacyEditing(null); setLegacyFile(null); }}>Cancel</Button>
            <Button className="flex-1" onClick={saveLegacyEdit}>Save Changes</Button>
          </div>
        </div>
      </CenterModal>

      {/* Delete confirmation */}
      <CenterModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Achievement">
        <div className="space-y-4">
          <p className="text-sm text-ink">Are you sure you want to delete this {deleteTarget?.type?.toLowerCase()}{deleteTarget?.type !== "Project" ? " certificate" : ""}?</p>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="danger" className="flex-1" onClick={confirmDelete}>Delete</Button>
          </div>
        </div>
      </CenterModal>
    </>
  );
}
