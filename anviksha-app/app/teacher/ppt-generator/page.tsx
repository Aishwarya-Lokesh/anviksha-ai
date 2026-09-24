"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { PillNav } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toaster";
import { motion, AnimatePresence } from "framer-motion";
import { Presentation, FileText, RotateCw, Download, ChevronLeft, ChevronRight, Upload, Trash2, BookOpen, Sparkles, Layers, Check, X } from "lucide-react";
import { api } from "@/lib/api";

export default function ContentGeneratorPage() {
  const [outputType, setOutputType] = useState<"ppt" | "notes">("ppt");
  const [subjects, setSubjects] = useState<any[]>([]);
  const [subjectId, setSubjectId] = useState<number | "">("");

  const [styleRefs, setStyleRefs] = useState<any[]>([]);
  const [selectedStyleRefId, setSelectedStyleRefId] = useState<number | "">("");
  const [uploadingStyle, setUploadingStyle] = useState(false);

  const [contentSources, setContentSources] = useState<any[]>([]);
  const [uploadingSource, setUploadingSource] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<number | "">("");

  // Multi-chapter selection + saved module mapping
  const [checkedChapters, setCheckedChapters] = useState<string[]>([]);
  const [savedModules, setSavedModules] = useState<any[]>([]);
  const [showSaveModule, setShowSaveModule] = useState(false);
  const [moduleName, setModuleName] = useState("");
  const [activeGeneration, setActiveGeneration] = useState<{ chapterTitle?: string; moduleId?: number; chapterTitles?: string[]; label: string } | null>(null);

  const [numSlides, setNumSlides] = useState(8);
  const [automaticSlideCount, setAutomaticSlideCount] = useState(true);
  const [audience, setAudience] = useState("Beginner");
  const [examOrientation, setExamOrientation] = useState("High");
  const [contentDepth, setContentDepth] = useState("Detailed");
  const [includeExamples, setIncludeExamples] = useState(true);
  const [includeDiagrams, setIncludeDiagrams] = useState(true);
  const [includeExamQuestions, setIncludeExamQuestions] = useState(true);
  const [includeRevision, setIncludeRevision] = useState(true);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [realSlides, setRealSlides] = useState<{ title: string; content: string }[]>([]);
  const [realNotes, setRealNotes] = useState("");
  const [connected, setConnected] = useState(true);
  const [notice, setNotice] = useState("");
  const [refsUsed, setRefsUsed] = useState(0);
  const [chaptersDetected, setChaptersDetected] = useState(true);
  const [slideIdx, setSlideIdx] = useState(0);
  const [plannedSlideCount, setPlannedSlideCount] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [generationElapsed, setGenerationElapsed] = useState(0);
  const [generationStage, setGenerationStage] = useState("");
  const [history, setHistory] = useState<any[]>([]);
  const { push } = useToast();

  const loadStyleRefs = () => api.listStyleReferences(outputType, subjectId || undefined).then(setStyleRefs).catch(() => {});
  const loadContentSources = () => api.listContentSources(subjectId || undefined).then(setContentSources).catch(() => {});
  const loadModules = (sourceId: number) => api.listModuleMappings(sourceId).then(setSavedModules).catch(() => {});
  const loadHistory = () => api.listGeneratedPresentations().then(setHistory).catch(() => {});

  useEffect(() => { api.teacherSubjects().then(setSubjects).catch(() => {}); }, []);
  useEffect(() => { loadHistory(); }, []);
  useEffect(() => { loadStyleRefs(); }, [outputType, subjectId]);
  useEffect(() => { loadContentSources(); }, [subjectId]);
  useEffect(() => { if (selectedSourceId) loadModules(selectedSourceId as number); setCheckedChapters([]); }, [selectedSourceId]);
  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setGenerationElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    const styleTimer = window.setTimeout(() => setGenerationStage("Applying your saved PPT style…"), 1200);
    const generationTimer = window.setTimeout(() => setGenerationStage("Generating grounded slide content…"), 3500);
    return () => { window.clearInterval(timer); window.clearTimeout(styleTimer); window.clearTimeout(generationTimer); };
  }, [loading]);

  const handleStyleUpload = async (file: File) => {
    setUploadingStyle(true);
    try {
      const response = await api.uploadStyleReference(outputType, file, subjectId || undefined);
      if (outputType === "ppt") setSelectedStyleRefId(response.id);
      push(`Learned real style from ${file.name}`);
      loadStyleRefs();
    } catch (e: any) {
      push(e.message || "Upload failed", "error");
    }
    setUploadingStyle(false);
  };

  const handleSourceUpload = async (file: File) => {
    setUploadingSource(true);
    try {
      const res = await api.uploadContentSource(file, subjectId || undefined);
      setSelectedSourceId(res.id);
      setCheckedChapters([]);
      push(res.chapters_detected ? `Found ${res.chapters.length} real chapters in ${file.name}` : `No clear chapter headings found — split into ${res.chapters.length} sections instead`);
      loadContentSources();
    } catch (e: any) {
      push(e.message || "Upload failed", "error");
    }
    setUploadingSource(false);
  };

  const selectedSource = contentSources.find((s: any) => s.id === selectedSourceId);

  const toggleChapter = (title: string) => {
    setCheckedChapters((prev) => prev.includes(title) ? prev.filter((t) => t !== title) : [...prev, title]);
  };

  const saveModule = async () => {
    if (!moduleName.trim() || checkedChapters.length === 0 || !selectedSourceId) {
      push("Give the module a name and select at least one chapter", "error");
      return;
    }
    try {
      await api.createModuleMapping({ content_source_id: selectedSourceId, module_name: moduleName, chapter_titles: checkedChapters });
      push(`Saved "${moduleName}" — ${checkedChapters.length} chapter(s) mapped`);
      setShowSaveModule(false);
      setModuleName("");
      setCheckedChapters([]);
      loadModules(selectedSourceId as number);
    } catch (e: any) {
      push(e.message || "Save failed", "error");
    }
  };

  const generate = async (target: { chapterTitle?: string; moduleId?: number; chapterTitles?: string[]; label: string }, forceNewVersion = false) => {
    setLoading(true);
    setGenerated(false);
    setGenerationElapsed(0);
    setPlannedSlideCount(null);
    setGenerationStage("Validating selected chapters and preparing source…");
    setActiveGeneration(target);
    try {
      const res = await api.generateStyledContent({
        output_type: outputType, content_source_id: selectedSourceId,
        chapter_title: target.chapterTitle, module_mapping_id: target.moduleId,
        selected_chapter_titles: target.chapterTitles,
        subject_id: subjectId || undefined, style_reference_id: selectedStyleRefId || undefined, num_slides: numSlides,
        automatic_slide_count: automaticSlideCount, audience, exam_orientation: examOrientation, content_depth: contentDepth,
        include_examples: includeExamples, include_diagrams: includeDiagrams,
        include_exam_questions: includeExamQuestions, include_revision: includeRevision, force_new_version: forceNewVersion,
      });
      setConnected(res.connected);
      setRefsUsed(res.style_references_used);
      setChaptersDetected(res.chapters_detected);
      setPlannedSlideCount(res.planned_slide_count || null);
      if (res.error || !res.connected || (outputType === "ppt" && !Array.isArray(res.slides)) || (outputType === "ppt" && res.slides.length === 0)) {
        setGenerated(false);
        setNotice(res.message || "The presentation could not be generated. Please try again.");
        push(res.message || "PPT generation failed", "error");
      } else if (outputType === "ppt") {
        setNotice("");
        setRealSlides(res.slides);
        setSlideIdx(0);
        setGenerated(true);
        loadHistory();
        push(res.reused ? "Reused the matching saved presentation — no AI call was made" : `Generated using ${res.style_references_used} real style reference(s)`);
      } else {
        setRealNotes(res.notes);
        setGenerated(true);
        push(`Generated using ${res.style_references_used} real style reference(s)`);
      }
    } catch (e: any) {
      push(e.message || "Backend unreachable", "error");
    }
    setGenerationStage("");
    setLoading(false);
  };

  const updateSlideField = (idx: number, field: "title" | "content", value: string) => {
    setRealSlides((prev) => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s));
  };

  const deleteCurrentSlide = () => {
    if (realSlides.length <= 1) {
      push("A presentation must contain at least one slide", "error");
      return;
    }
    setRealSlides((prev) => prev.filter((_, index) => index !== slideIdx));
    setSlideIdx((index) => Math.min(index, realSlides.length - 2));
    push("Slide removed from this draft");
  };

  const discardDraft = () => {
    setGenerated(false);
    setRealSlides([]);
    setRealNotes("");
    setActiveGeneration(null);
    setSlideIdx(0);
    push("Draft discarded");
  };

  const downloadPPT = async () => {
    setExporting(true);
    try {
      const blob = await api.exportPPT(activeGeneration?.label || "Presentation", realSlides, selectedStyleRefId || undefined);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${activeGeneration?.label || "presentation"}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      push("Real .pptx downloaded");
    } catch {
      push("Export failed", "error");
    }
    setExporting(false);
  };

  const downloadNotes = async () => {
    setExporting(true);
    try {
      const blob = await api.exportNotes(activeGeneration?.label || "Notes", realNotes);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${activeGeneration?.label || "notes"}.docx`;
      a.click();
      URL.revokeObjectURL(url);
      push("Real .docx downloaded");
    } catch {
      push("Export failed", "error");
    }
    setExporting(false);
  };

  return (
    <>
      <Topbar greeting="AI Content Generator" subtitle="Dashboard > PPT & Notes Generator" avatarLetter="R" />
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PillNav items={[{ key: "ppt", label: "PPT" }, { key: "notes", label: "Notes" }]} active={outputType} onChange={(v) => setOutputType(v as "ppt" | "notes")} />
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value ? Number(e.target.value) : "")} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
            <option value="">All subjects</option>
            {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card hover>
            <SectionTitle title={`Teach it your ${outputType === "ppt" ? "PPT" : "notes"} style`} subtitle={outputType === "ppt" ? "Upload a past .pptx to learn its theme, layouts, explanation density, headings, and bullet/step style. It never supplies factual content." : "Upload past .docx notes — real structure is learned from each one"} />
            <label className="border-2 border-dashed border-gray-200 rounded-xl p-4 flex items-center gap-3 text-sm text-muted cursor-pointer hover:border-brand/40 transition-colors">
              <Upload size={18} className="text-brand" />
              {uploadingStyle ? "Reading real file structure..." : `Upload a past ${outputType === "ppt" ? ".pptx" : ".docx"} file`}
              <input type="file" accept={outputType === "ppt" ? ".pptx" : ".docx"} className="hidden" onChange={(e) => e.target.files?.[0] && handleStyleUpload(e.target.files[0])} />
            </label>
            <div className="mt-4 space-y-2">
              {styleRefs.length === 0 && <p className="text-xs text-muted text-center py-4">No style references uploaded yet — generation will use a clean default format.</p>}
              {styleRefs.map((r: any) => (
                <div key={r.id} onClick={() => outputType === "ppt" && setSelectedStyleRefId(r.id)} className={`flex items-center justify-between p-2.5 rounded-xl text-sm ${outputType === "ppt" ? "cursor-pointer" : ""} ${selectedStyleRefId === r.id ? "border border-brand bg-brand-light" : "bg-gray-50"}`}>
                  <div>
                    <div className="font-medium text-ink">{r.filename}</div>
                    <div className="text-xs text-muted">
                      {r.output_type === "ppt"
                        ? `${r.style_profile?.slide_count} slides · ${r.style_profile?.avg_bullets_per_slide} bullets/slide avg`
                        : `${r.style_profile?.heading_count} headings · ${r.style_profile?.avg_paragraph_words} words/paragraph avg`}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {outputType === "ppt" && selectedStyleRefId === r.id && <Badge tone="brand">Selected template</Badge>}
                    <button onClick={async (e) => { e.stopPropagation(); await api.deleteStyleReference(r.id); if (selectedStyleRefId === r.id) setSelectedStyleRefId(""); loadStyleRefs(); }} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card hover>
            <SectionTitle title="Upload the real content source" subtitle="This PDF/DOCX is the factual source for the PPT. Its text is extracted and its chapters are selected below." />
            <label className="border-2 border-dashed border-gray-200 rounded-xl p-4 flex items-center gap-3 text-sm text-muted cursor-pointer hover:border-brand/40 transition-colors">
              <BookOpen size={18} className="text-brand" />
              {uploadingSource ? "Extracting text and chapters..." : "Upload the textbook or notes used for PPT content (.pdf or .docx)"}
              <input type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && handleSourceUpload(e.target.files[0])} />
            </label>
            <div className="mt-4 space-y-2">
              {contentSources.length === 0 && <p className="text-xs text-muted text-center py-4">No textbook uploaded yet.</p>}
              {contentSources.map((s: any) => (
                <div key={s.id} className={`p-2.5 rounded-xl border cursor-pointer transition-colors ${selectedSourceId === s.id ? "border-brand bg-brand-light" : "border-gray-100 bg-gray-50 hover:border-gray-200"}`} onClick={() => setSelectedSourceId(s.id)}>
                  <div className="flex items-center justify-between">
                    <div className="font-medium text-ink text-sm">{s.filename}</div>
                    <button onClick={(e) => { e.stopPropagation(); api.deleteContentSource(s.id).then(loadContentSources); }} className="p-1 rounded-lg hover:bg-danger/10 text-danger"><Trash2 size={13} /></button>
                  </div>
                  <div className="text-xs text-muted mt-1">
                    {s.chapters_detected ? `${s.chapters.length} real chapters detected` : `No chapter headings found — split into ${s.chapters.length} sections`}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {selectedSource && (
          <Card hover>
            <SectionTitle title={`What should this be built from?`} subtitle="Pick a saved module, or select real chapters yourself and save a new module mapping" />

            {savedModules.length > 0 && (
              <div className="mb-5">
                <div className="text-xs font-semibold text-muted mb-2 flex items-center gap-1.5"><Layers size={13} /> Saved Modules</div>
                <div className="flex flex-wrap gap-2">
                  {savedModules.map((m: any) => (
                    <button key={m.id} onClick={() => generate({ moduleId: m.id, label: m.module_name })} className="text-xs font-medium px-3 py-2 rounded-xl border border-gray-200 bg-white text-ink hover:border-brand/40 flex items-center gap-2 group">
                      {m.module_name}
                      <span className="text-[10px] text-muted">({m.chapter_titles.length} ch.)</span>
                      <Trash2 size={11} className="opacity-0 group-hover:opacity-100 text-danger" onClick={(e) => { e.stopPropagation(); api.deleteModuleMapping(m.id).then(() => loadModules(selectedSourceId as number)); }} />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="text-xs font-semibold text-muted mb-2">Real chapters in "{selectedSource.filename}"</div>
            <div className="space-y-1.5 mb-4 max-h-56 overflow-y-auto">
              {selectedSource.chapters.map((c: any) => (
                <label key={c.title} className="flex items-center gap-2.5 p-2 rounded-lg hover:bg-gray-50 cursor-pointer text-sm">
                  <input type="checkbox" checked={checkedChapters.includes(c.title)} onChange={() => toggleChapter(c.title)} className="w-4 h-4 accent-brand" />
                  <span className="flex-1 text-ink">{c.title}</span>
                  <button onClick={(e) => { e.preventDefault(); generate({ chapterTitle: c.title, label: c.title }); }} className="text-xs text-brand hover:underline">Generate this chapter alone</button>
                </label>
              ))}
            </div>

            {checkedChapters.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <Badge tone="brand">{checkedChapters.length} chapter(s) selected</Badge>
                <Button size="sm" onClick={() => setShowSaveModule(true)}>Save as Module</Button>
                <Button size="sm" variant="secondary" onClick={() => generate({ chapterTitles: checkedChapters, label: checkedChapters.join(" / ") })}>
                  Generate from selection (without saving)
                </Button>
              </div>
            )}

            {outputType === "ppt" && (
              <div className="border-t border-gray-100 pt-4 mt-4 space-y-3">
                <div className="text-xs font-semibold text-muted">Generation Settings</div>
                <div className="grid md:grid-cols-3 gap-3 text-sm">
                  <label>Target audience<select value={audience} onChange={(e) => setAudience(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label>
                  <label>Exam orientation<select value={examOrientation} onChange={(e) => setExamOrientation(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5"><option>High</option><option>Medium</option><option>Low</option></select></label>
                  <label>Content depth<select value={contentDepth} onChange={(e) => setContentDepth(e.target.value)} className="mt-1 w-full border border-gray-200 rounded-lg px-2 py-1.5"><option>Detailed</option><option>Balanced</option><option>Concise</option></select></label>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink">
                  {[[includeExamples, setIncludeExamples, "Examples"], [includeDiagrams, setIncludeDiagrams, "Educational diagrams"], [includeExamQuestions, setIncludeExamQuestions, "Expected exam questions"], [includeRevision, setIncludeRevision, "Revision slides"]].map(([checked, setter, label]: any) => <label key={label} className="flex items-center gap-2"><input type="checkbox" checked={checked} onChange={(e) => setter(e.target.checked)} className="accent-brand" />{label}</label>)}
                  <label className="flex items-center gap-2"><input type="checkbox" checked={automaticSlideCount} onChange={(e) => setAutomaticSlideCount(e.target.checked)} className="accent-brand" />Automatic slide count</label>
                </div>
                <label className={`text-xs font-medium flex items-center gap-2 ${automaticSlideCount ? "text-muted/50" : "text-muted"}`}>
                  Number of slides
                  <input
                    type="number" min="1" max="30" value={numSlides} disabled={automaticSlideCount}
                    onChange={(e) => setNumSlides(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                    className="w-20 border border-gray-200 rounded-lg px-2 py-1.5 text-sm outline-none disabled:bg-gray-50 disabled:text-muted/50"
                  />
                  {automaticSlideCount && <span className="text-[11px] text-muted">Uncheck "Automatic slide count" to set this manually</span>}
                </label>
              </div>
            )}
            {loading && <div className="text-xs text-muted flex items-center gap-2 mt-2"><RotateCw size={13} className="animate-spin" /> Generating "{activeGeneration?.label}"...</div>}
            {loading && outputType === "ppt" && (
              <div className="mt-4 rounded-xl border border-brand/20 bg-brand-light p-4 grid sm:grid-cols-3 gap-3 text-sm">
                <div><div className="text-xs text-muted">Current status</div><div className="font-medium text-ink mt-1">{generationStage}</div></div>
                <div><div className="text-xs text-muted">Elapsed time</div><div className="font-semibold text-ink numeric mt-1">{generationElapsed}s</div></div>
                <div><div className="text-xs text-muted">Slides</div><div className="font-semibold text-ink mt-1">0 of {numSlides} complete · {numSlides} remaining</div><div className="text-[10px] text-muted mt-1">Slides are validated as one grounded presentation, then shown together.</div></div>
              </div>
            )}
          </Card>
        )}

        <Card hover className="!p-0 overflow-hidden">
          <div className="bg-gray-50 px-5 py-2.5 text-xs font-semibold text-muted border-b border-gray-100 flex items-center justify-between">
            {outputType === "ppt" ? "Presentation Preview — editable before download" : "Notes Preview — editable before download"}
            {generated && (
              <div className="flex items-center gap-3">
                <button onClick={discardDraft} className="text-danger hover:underline flex items-center gap-1"><X size={12} /> Discard draft</button>
                <button onClick={outputType === "ppt" ? downloadPPT : downloadNotes} disabled={exporting} className="text-brand hover:underline flex items-center gap-1">
                  {exporting ? <RotateCw size={12} className="animate-spin" /> : <Download size={12} />} Download real .{outputType === "ppt" ? "pptx" : "docx"}
                </button>
              </div>
            )}
          </div>
          <div className="p-6 min-h-[300px] flex flex-col items-center justify-center">
            <AnimatePresence mode="wait">
              {generated && outputType === "ppt" && realSlides.length > 0 ? (
                <motion.div key="slide" className="w-full">
                  <div className="flex items-center justify-center gap-2 mb-3 flex-wrap">
                    <Badge tone="success">{refsUsed} real style reference(s) used</Badge>
                    <Badge tone={chaptersDetected ? "success" : "warning"}>{chaptersDetected ? "Real content detected" : "Fallback section"}</Badge>
                    <Badge tone="brand">{realSlides.length} of {plannedSlideCount || numSlides} slides generated</Badge>
                  </div>
                  <div className="bg-gradient-to-br from-brand to-[#7A5FEA] rounded-xl p-6 mb-4">
                    <input value={realSlides[slideIdx]?.title || ""} onChange={(e) => updateSlideField(slideIdx, "title", e.target.value)} className="w-full bg-transparent text-white text-xl font-bold font-display text-center mb-3 outline-none border-b border-white/20 focus:border-white/60 pb-2" />
                    <textarea value={realSlides[slideIdx]?.content || ""} onChange={(e) => updateSlideField(slideIdx, "content", e.target.value)} rows={5} className="w-full bg-white/10 text-white text-sm rounded-lg p-3 outline-none resize-none placeholder-white/50" />
                  </div>
                  <div className="flex items-center justify-between">
                    <button onClick={() => setSlideIdx((i) => Math.max(0, i - 1))} disabled={slideIdx === 0} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronLeft size={18} /></button>
                    <span className="text-xs text-muted">Slide {slideIdx + 1} of {realSlides.length}</span>
                    <div className="flex items-center gap-1">
                      <button onClick={deleteCurrentSlide} className="p-2 rounded-lg hover:bg-danger/10 text-danger" title="Delete this slide"><Trash2 size={16} /></button>
                      <button onClick={() => setSlideIdx((i) => Math.min(realSlides.length - 1, i + 1))} disabled={slideIdx === realSlides.length - 1} className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30"><ChevronRight size={18} /></button>
                    </div>
                  </div>
                </motion.div>
              ) : generated && outputType === "notes" && realNotes ? (
                <motion.div key="notes" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full">
                  <div className="flex items-center justify-center gap-2 mb-3 flex-wrap">
                    <Badge tone="success">{refsUsed} real style reference(s) used</Badge>
                    <Badge tone={chaptersDetected ? "success" : "warning"}>{chaptersDetected ? "Real content detected" : "Fallback section"}</Badge>
                  </div>
                  <textarea value={realNotes} onChange={(e) => setRealNotes(e.target.value)} rows={16} className="w-full bg-gray-50 rounded-xl p-5 text-sm text-ink outline-none resize-none" />
                </motion.div>
              ) : !connected ? (
                <div className="text-center text-sm max-w-xs">
                  {outputType === "ppt" ? <Presentation size={32} className="opacity-30 mx-auto mb-3" /> : <FileText size={32} className="opacity-30 mx-auto mb-3" />}
                  <div className="bg-warning/10 text-[#9c6b12] rounded-xl p-3">{notice}</div>
                </div>
              ) : (
                <div className="text-muted text-sm flex flex-col items-center gap-2">
              {notice ? <div className="bg-danger/10 text-danger rounded-xl p-3 text-center max-w-md">{notice}</div> : <><>{outputType === "ppt" ? <Presentation size={32} className="opacity-30" /> : <FileText size={32} className="opacity-30" />}</>Upload a textbook, pick chapters or a saved module, and generate to preview</>}
            </div>
          )}
            </AnimatePresence>
          </div>
        </Card>

        {outputType === "ppt" && history.length > 0 && (
          <Card>
            <SectionTitle title="My Generated Presentations" subtitle="Reuse a saved draft without spending another AI request." />
            <div className="space-y-2">
              {history.slice(0, 8).map((item) => (
                <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 p-3 text-sm">
                  <div><div className="font-medium text-ink">{item.title}</div><div className="text-xs text-muted">{item.source_filename} · {item.slide_count} slides · version {item.version}</div></div>
                  <button onClick={async () => { const draft = await api.getGeneratedPresentation(item.id); setRealSlides(draft.slides); setActiveGeneration({ label: draft.title }); setSelectedStyleRefId(draft.style_reference_id || ""); setPlannedSlideCount(draft.slide_count); setSlideIdx(0); setGenerated(true); setNotice(""); }} className="text-xs text-brand hover:underline">Open</button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <CenterModal open={showSaveModule} onClose={() => setShowSaveModule(false)} title="Save as Module">
        <div className="space-y-4">
          <p className="text-xs text-muted">This mapping is saved permanently — next time, just click "{moduleName || "this module"}" instead of re-selecting chapters.</p>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Module Name</label>
            <input value={moduleName} onChange={(e) => setModuleName(e.target.value)} placeholder="e.g. Module 1: Cryptography Basics" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none" />
          </div>
          <div className="text-xs text-muted">
            Real chapters included: {checkedChapters.map((c) => <div key={c} className="flex items-center gap-1 mt-1"><Check size={12} className="text-success" /> {c}</div>)}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setShowSaveModule(false)}>Cancel</Button>
            <Button className="flex-1" onClick={saveModule}>Save Module</Button>
          </div>
        </div>
      </CenterModal>
    </>
  );
}
