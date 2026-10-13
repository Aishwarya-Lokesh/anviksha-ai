"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { PillNav } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toaster";
import { motion, AnimatePresence } from "framer-motion";
import { Presentation, FileText, RotateCw, Download, ChevronLeft, ChevronRight, Upload, Trash2, BookOpen, Sparkles, Layers, Check, X, ImageOff, ImagePlus, Shuffle } from "lucide-react";
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
  const [realSlides, setRealSlides] = useState<any[]>([]);
  // Deck look: colour theme and stock photos (photos need the server's photo key).
  const [themes, setThemes] = useState<{ key: string; label: string; brand: string; dark: string; light: string }[]>([]);
  const [theme, setTheme] = useState("violet");
  const [imagesAvailable, setImagesAvailable] = useState(false);
  const [includeImages, setIncludeImages] = useState(true);
  const [imageBusy, setImageBusy] = useState(false);
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
      push(`Learned style from ${file.name}`);
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
      push(res.chapters_detected ? `Found ${res.chapters.length} chapters in ${file.name}` : `No clear chapter headings found — split into ${res.chapters.length} sections instead`);
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
        push(res.reused ? "Reused the matching saved presentation — no AI call was made" : `Generated using ${res.style_references_used} style reference(s)`);
      } else {
        setRealNotes(res.notes);
        setGenerated(true);
        push(`Generated using ${res.style_references_used} style reference(s)`);
      }
    } catch (e: any) {
      push(e.message || "Could not reach the server. Please try again.", "error");
    }
    setGenerationStage("");
    setLoading(false);
  };

  useEffect(() => {
    api.slideThemes().then((d) => { setThemes(d.themes || []); setImagesAvailable(!!d.images_available); }).catch(() => {});
  }, []);

  const palette = themes.find((t) => t.key === theme) || { key: "violet", label: "Violet", brand: "#5B3FD9", dark: "#4530B0", light: "#EDEBF9" };
  const currentSlide = realSlides[slideIdx];
  // A slide that already has a figure, a process flow or a comparison keeps that instead of a photo.
  const slideTakesPhoto = !!currentSlide && !currentSlide.textbook_image_base64 && !(currentSlide.process_steps || []).length && !(currentSlide.comparison_points || []).length;

  const loadSlideImage = async (idx: number, n: number) => {
    const slide = realSlides[idx];
    if (!slide?.title) return;
    setImageBusy(true);
    try {
      const found = await api.slideImage(slide.title, n);
      setRealSlides((prev) => prev.map((s, i) => i !== idx ? s : found.available
        ? { ...s, image_url: found.url, image_thumb: found.thumb, image_credit: found.credit, image_n: n, no_image: false, image_missing: false }
        : { ...s, image_url: undefined, image_thumb: undefined, image_missing: true }));
      if (!found.available && n > 0) push("No more photos for this slide", "info");
    } catch {
      // the preview falls back to the designed panel
    }
    setImageBusy(false);
  };

  // Each slide gets its photo the first time it is looked at.
  useEffect(() => {
    if (!generated || outputType !== "ppt" || !imagesAvailable || !includeImages || !slideTakesPhoto) return;
    if (currentSlide.image_url || currentSlide.no_image || currentSlide.image_missing) return;
    loadSlideImage(slideIdx, 0);
  }, [slideIdx, generated, imagesAvailable, includeImages, realSlides.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeSlideImage = () => setRealSlides((prev) => prev.map((s, i) => i === slideIdx ? { ...s, image_url: undefined, image_thumb: undefined, no_image: true } : s));

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
      const blob = await api.exportPPT(activeGeneration?.label || "Presentation", realSlides, selectedStyleRefId || undefined, { theme, includeImages });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${activeGeneration?.label || "presentation"}.pptx`;
      a.click();
      URL.revokeObjectURL(url);
      push(".pptx downloaded");
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
      push(".docx downloaded");
    } catch {
      push("Export failed", "error");
    }
    setExporting(false);
  };

  return (
    <>
      <Topbar greeting="AI Content Generator" subtitle="Dashboard > PPT & Notes Generator" avatarLetter="R" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <PillNav items={[{ key: "ppt", label: "PPT" }, { key: "notes", label: "Notes" }]} active={outputType} onChange={(v) => setOutputType(v as "ppt" | "notes")} />
          <select value={subjectId} onChange={(e) => setSubjectId(e.target.value ? Number(e.target.value) : "")} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
            <option value="">All subjects</option>
            {subjects.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
          </select>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card hover>
            <SectionTitle title={`Teach it your ${outputType === "ppt" ? "PPT" : "notes"} style`} subtitle={outputType === "ppt" ? "Upload a past .pptx to learn its theme, layouts, explanation density, headings, and bullet/step style. It never supplies factual content." : "Upload past .docx notes — structure is learned from each one"} />
            <label className="border-2 border-dashed border-gray-200 rounded-xl p-4 flex items-center gap-3 text-sm text-muted cursor-pointer hover:border-brand/40 transition-colors">
              <Upload size={18} className="text-brand" />
              {uploadingStyle ? "Reading file structure..." : `Upload a past ${outputType === "ppt" ? ".pptx" : ".docx"} file`}
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
            <SectionTitle title="Upload the content source" subtitle="This PDF/DOCX is the factual source for the PPT. Its text is extracted and its chapters are selected below." />
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
                    {s.chapters_detected ? `${s.chapters.length} chapters detected` : `No chapter headings found — split into ${s.chapters.length} sections`}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {selectedSource && (
          <Card hover>
            <SectionTitle title={`What should this be built from?`} subtitle="Pick a saved module, or select chapters yourself and save a new module mapping" />

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

            <div className="text-xs font-semibold text-muted mb-2">Chapters in "{selectedSource.filename}"</div>
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
                  {exporting ? <RotateCw size={12} className="animate-spin" /> : <Download size={12} />} Download .{outputType === "ppt" ? "pptx" : "docx"}
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
                    <Badge tone={chaptersDetected ? "success" : "warning"}>{chaptersDetected ? "Content detected" : "Fallback section"}</Badge>
                    <Badge tone="brand">{realSlides.length} of {plannedSlideCount || numSlides} slides generated</Badge>
                  </div>
                  <div className="flex items-center gap-3 flex-wrap mb-3">
                    <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Colour theme">
                      <span className="text-xs text-muted mr-1">Theme</span>
                      {(themes.length ? themes : [palette]).map((t) => (
                        <button
                          key={t.key}
                          role="radio"
                          aria-checked={theme === t.key}
                          aria-label={`${t.label} theme`}
                          title={t.label}
                          onClick={() => setTheme(t.key)}
                          className={`w-9 h-9 rounded-full flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ring-offset-2 ${theme === t.key ? "ring-2 ring-brand" : ""}`}
                          style={{ backgroundColor: t.brand }}
                        >
                          {theme === t.key && <Check size={15} className="text-white" />}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-xs text-ink min-h-[44px] cursor-pointer ml-auto">
                      <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} className="w-5 h-5 accent-[#5B3FD9]" />
                      Add photos to slides
                    </label>
                  </div>
                  {includeImages && !imagesAvailable && (
                    <p className="text-xs text-muted mb-3">Stock photos aren't switched on for this server yet, so slides without a diagram use a designed panel in the theme colour.</p>
                  )}
                  {/* The slide as it will look in the file: always a light page, whatever the app theme. */}
                  <div className="force-light rounded-xl overflow-hidden border border-gray-200 bg-white mb-4 shadow-soft">
                    <div className="h-1.5" style={{ backgroundColor: palette.brand }} />
                    <div className={`p-4 md:p-5 grid gap-4 ${includeImages && slideTakesPhoto && !currentSlide?.no_image ? "md:grid-cols-5" : ""}`}>
                      <div className="md:col-span-3 min-w-0">
                        <input aria-label="Slide title" value={currentSlide?.title || ""} onChange={(e) => updateSlideField(slideIdx, "title", e.target.value)} className="w-full bg-transparent text-lg md:text-xl font-bold font-display mb-2 outline-none border-b border-gray-200 focus:border-gray-400 pb-1.5" style={{ color: palette.dark }} />
                        <textarea aria-label="Slide content" value={currentSlide?.content || ""} onChange={(e) => updateSlideField(slideIdx, "content", e.target.value)} rows={7} className="w-full bg-gray-50 text-ink text-sm rounded-lg p-3 outline-none resize-y focus:ring-2 focus:ring-brand/20" />
                      </div>
                      {includeImages && slideTakesPhoto && !currentSlide?.no_image && (
                        <div className="md:col-span-2 min-w-0">
                          {currentSlide?.image_thumb ? (
                            <figure>
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={currentSlide.image_thumb} alt={`Photo for ${currentSlide.title}`} className="w-full aspect-[4/3] object-cover rounded-lg border border-gray-200" />
                              <figcaption className="text-[10px] text-muted text-right mt-1">Photo: {currentSlide.image_credit} / Pexels</figcaption>
                            </figure>
                          ) : (
                            <div className="relative w-full aspect-[4/3] rounded-xl overflow-hidden p-4 flex flex-col justify-end" style={{ backgroundColor: palette.light }}>
                              <span className="absolute top-3 right-3 w-14 h-14 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ backgroundColor: palette.brand }}>{String(slideIdx + 1).padStart(2, "0")}</span>
                              <span className="absolute top-5 left-4 w-10 h-1 rounded" style={{ backgroundColor: palette.brand }} />
                              <span className="text-[10px] font-bold tracking-wide" style={{ color: palette.dark }}>{currentSlide?.diagram_description ? "PICTURE THIS" : "IN FOCUS"}</span>
                              <span className="text-xs text-ink line-clamp-4 mt-1">{imageBusy ? "Finding a photo…" : currentSlide?.diagram_description || currentSlide?.title}</span>
                            </div>
                          )}
                          <div className="flex gap-2 mt-2">
                            {imagesAvailable && (
                              <button onClick={() => loadSlideImage(slideIdx, currentSlide?.image_url ? (currentSlide.image_n || 0) + 1 : 0)} disabled={imageBusy} className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-lg text-xs font-semibold text-brand bg-brand-50 hover:bg-brand-light disabled:opacity-50">
                                <Shuffle size={13} /> {currentSlide?.image_url ? "Another photo" : "Find a photo"}
                              </button>
                            )}
                            <button onClick={removeSlideImage} className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] rounded-lg text-xs font-semibold text-muted bg-gray-50 hover:bg-gray-100">
                              <ImageOff size={13} /> Text only
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    {currentSlide?.core_takeaway && (
                      <div className="mx-4 md:mx-5 mb-4 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: palette.light, color: palette.dark }}><span className="font-bold">Key takeaway: </span>{currentSlide.core_takeaway}</div>
                    )}
                  </div>
                  {includeImages && slideTakesPhoto && currentSlide?.no_image && (
                    <button onClick={() => { setRealSlides((prev) => prev.map((s, i) => i === slideIdx ? { ...s, no_image: false, image_missing: false } : s)); }} className="inline-flex items-center gap-1.5 min-h-[40px] text-xs font-semibold text-brand hover:underline mb-2">
                      <ImagePlus size={13} /> Give this slide a picture panel
                    </button>
                  )}
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
                    <Badge tone={chaptersDetected ? "success" : "warning"}>{chaptersDetected ? "Content detected" : "Fallback section"}</Badge>
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
            Chapters included: {checkedChapters.map((c) => <div key={c} className="flex items-center gap-1 mt-1"><Check size={12} className="text-success" /> {c}</div>)}
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
