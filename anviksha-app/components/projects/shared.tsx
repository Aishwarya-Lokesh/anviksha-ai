"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ImageOff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/Primitives";
import { Markdown } from "@/components/ui/Markdown";
import { api, fetchFile } from "@/lib/api";

export type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "para"; text: string }
  | { type: "bullets"; items: string[] }
  | { type: "figure"; image_id: number; caption: string }
  | { type: "table"; caption: string; rows: string[][] };
export type Chapter = { key: string; title: string; blocks: Block[]; missing?: string[]; skipped?: boolean };
export type Slide = { title: string; bullets: string[]; notes?: string; image_id?: number; source?: string };
export type Draft = { chapters?: Chapter[]; slides?: Slide[]; abstract?: string[]; acknowledgement?: string[]; references?: string[]; warnings?: string[] };

export const INPUT = "w-full border border-gray-200 bg-white rounded-xl px-3.5 min-h-[44px] text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30";
export const AREA = "w-full border border-gray-200 bg-white rounded-xl px-3.5 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30";

/** A picture that needs the signed-in person's token to load. */
export function AuthImage({ path, alt, className }: { path: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    fetchFile(path)
      .then(({ blob }) => {
        url = URL.createObjectURL(blob);
        if (!cancelled) setSrc(url);
      })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path]);
  if (failed) return <div className={`flex items-center justify-center bg-gray-50 text-muted ${className || ""}`}><ImageOff size={18} aria-label="Picture could not be loaded" /></div>;
  if (!src) return <div className={`flex items-center justify-center bg-gray-50 ${className || ""}`}><Loader2 size={16} className="animate-spin text-muted" /></div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}

/**
 * A built PDF shown one page at a time as pictures, so it looks the same on a
 * phone as on a computer. `base` is the address that answers with the number
 * of pages; `${base}/3` is the picture of page 3.
 */
export function PagePreview({ base, label, wide = false }: { base: string; label: string; wide?: boolean }) {
  const [pages, setPages] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    setPages(null);
    setPage(1);
    setError("");
    api.pageCount(base).then((d) => setPages(d.pages)).catch((e) => setError(e?.detail || "The preview could not be loaded."));
  }, [base]);

  if (error) return <p className="text-sm text-muted text-center py-8">{error}</p>;
  if (pages === null) return <p className="text-sm text-muted text-center py-8" role="status">Preparing the preview…</p>;
  const nav = "w-11 h-11 rounded-xl flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 outline-none focus-visible:ring-2 focus-visible:ring-brand/40";
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <button aria-label={`Previous ${label}`} className={nav} disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={18} /></button>
        <label className="text-sm text-muted flex items-center gap-2">
          {label[0].toUpperCase() + label.slice(1)}
          <select aria-label={`Go to ${label}`} value={page} onChange={(e) => setPage(Number(e.target.value))} className="border border-gray-200 bg-white rounded-lg px-2 min-h-[36px] text-sm text-ink">
            {Array.from({ length: pages }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
          </select>
          of {pages}
        </label>
        <button aria-label={`Next ${label}`} className={nav} disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={18} /></button>
      </div>
      <div className="force-light bg-gray-100 rounded-xl p-2 sm:p-4 flex justify-center">
        <AuthImage path={`${base}/${page}`} alt={`${label} ${page} of ${pages}`} className={`w-full ${wide ? "max-w-3xl aspect-video" : "max-w-xl aspect-[1/1.414]"} object-contain bg-white shadow-card rounded`} />
      </div>
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** What was read from an uploaded format, in plain words. */
export function FormatSummary({ analysis }: { analysis: any }) {
  if (!analysis) return null;
  const rows: [string, React.ReactNode][] = [];
  const style = (s: any) => (s ? `${s.font}, ${s.size ?? "?"} pt${s.bold ? ", bold" : ""}${s.italic ? ", italic" : ""}${s.align ? `, ${s.align}` : ""}${s.line_spacing ? `, line spacing ${s.line_spacing}` : ""}` : "not found in the format");
  if (analysis.kind === "report") {
    const m = analysis.page.margins_in;
    rows.push(["Page", `${analysis.page.width_in} × ${analysis.page.height_in} in; margins top ${m.top}, bottom ${m.bottom}, left ${m.left}, right ${m.right} in`]);
    rows.push(["Page numbers", analysis.sections.map((s: any) => `section ${s.section}: ${s.format === "lowerRoman" ? "i, ii, iii" : s.format === "upperRoman" ? "I, II, III" : "1, 2, 3"}${s.start ? ` from ${s.start}` : ""}`).join("; ")]);
    rows.push(["Header", analysis.headers.join(" / ") || "none"]);
    rows.push(["Footer", analysis.footers.join(" / ") || "none"]);
    rows.push(["Parts found", analysis.parts.join(", ")]);
    if (analysis.chapter_titles?.length) rows.push(["Sample chapters", analysis.chapter_titles.join(", ")]);
    for (const [name, value] of Object.entries(analysis.styles || {})) rows.push([name[0].toUpperCase() + name.slice(1), style(value)]);
    rows.push(["Captions", `${analysis.captions.figure} … and ${analysis.captions.table} … (table caption ${analysis.captions.table_caption_position})`]);
  } else {
    rows.push(["Slide", `${analysis.slide.width_in} × ${analysis.slide.height_in} in (${analysis.slide.shape})`]);
    rows.push(["On every slide", analysis.on_every_slide.map((b: any) => b.text || b.name).join(" · ") || "nothing extra"]);
    rows.push(["Slides in the format", analysis.sample_slides.map((s: any) => s.heading || `slide ${s.position}`).join(" → ")]);
    rows.push(["New slides use", analysis.content_slides_use]);
    for (const [name, value] of Object.entries(analysis.styles || {})) rows.push([name[0].toUpperCase() + name.slice(1), `${(value as any).size} pt`]);
  }
  return (
    <div className="space-y-3">
      {(analysis.warnings || []).map((w: string) => (
        <div key={w} className="flex items-start gap-2 p-3 rounded-xl bg-warning/10 text-sm text-ink"><AlertTriangle size={16} className="text-[#9c6b12] shrink-0 mt-0.5" /> {w}</div>
      ))}
      <dl className="text-sm divide-y divide-gray-100">
        {rows.map(([k, v]) => (
          <div key={k} className="py-2 grid sm:grid-cols-[11rem_1fr] gap-x-3 gap-y-0.5">
            <dt className="text-muted">{k}</dt>
            <dd className="text-ink break-words">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** The draft, read-only: chapters as they will be numbered, then the slides. */
export function DraftView({ draft, imagePath, only }: { draft: Draft; imagePath: (id: number) => string; only?: "report" | "slides" }) {
  const chapters = (draft.chapters || []).filter((c) => c.blocks?.length);
  return (
    <div className="space-y-6">
      {only !== "slides" && (
        <div className="force-light bg-white rounded-xl border border-gray-200 p-4 sm:p-8 space-y-4 max-w-3xl mx-auto">
          {(draft.abstract || []).length > 0 && (
            <section><h3 className="text-center font-bold text-ink mb-2">ABSTRACT</h3>{draft.abstract!.map((p, i) => <p key={i} className="text-sm text-ink text-justify mb-2">{p}</p>)}</section>
          )}
          {chapters.map((c, n) => {
            let sec = 0, sub = 0, fig = 0, tab = 0;
            return (
              <section key={c.key + n} className="pt-4 border-t border-gray-100 first:border-0 first:pt-0">
                <h3 className="text-center font-bold text-ink">CHAPTER {n + 1}</h3>
                <h3 className="text-center font-bold text-ink mb-3">{c.title.toUpperCase()}</h3>
                {c.blocks.map((b, i) => {
                  if (b.type === "heading") {
                    if (b.level === 3) sub += 1; else { sec += 1; sub = 0; }
                    return <h4 key={i} className={`font-semibold text-ink mt-3 mb-1 ${b.level === 3 ? "text-sm" : "text-base"}`}>{b.level === 3 ? `${n + 1}.${Math.max(sec, 1)}.${sub}` : `${n + 1}.${sec}`} {b.text}</h4>;
                  }
                  if (b.type === "para") return <div key={i} className="text-sm text-ink text-justify mb-2"><Markdown text={b.text} /></div>;
                  if (b.type === "bullets") return <ul key={i} className="list-disc pl-6 text-sm text-ink mb-2 space-y-0.5">{b.items.map((it, j) => <li key={j}>{it}</li>)}</ul>;
                  if (b.type === "figure") {
                    fig += 1;
                    return (
                      <figure key={i} className="my-3 text-center">
                        <AuthImage path={imagePath(b.image_id)} alt={b.caption} className="max-h-72 max-w-full mx-auto rounded border border-gray-200 object-contain" />
                        <figcaption className="text-xs font-semibold text-ink mt-1">Fig {n + 1}.{fig}: {b.caption}</figcaption>
                      </figure>
                    );
                  }
                  tab += 1;
                  return (
                    <div key={i} className="my-3">
                      <div className="text-xs font-semibold text-ink text-center mb-1">Table {n + 1}.{tab}: {b.caption}</div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs border border-gray-300">
                          <tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((cell, ci) => <td key={ci} className={`border border-gray-300 px-2 py-1 text-ink ${ri === 0 ? "font-semibold bg-gray-50" : ""}`}>{cell}</td>)}</tr>)}</tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </section>
            );
          })}
          {(draft.references || []).length > 0 && (
            <section className="pt-4 border-t border-gray-100"><h3 className="text-center font-bold text-ink mb-2">REFERENCES</h3>
              <ol className="text-sm text-ink space-y-1">{draft.references!.map((r, i) => <li key={i}>[{i + 1}] {r}</li>)}</ol>
            </section>
          )}
          {chapters.length === 0 && <p className="text-sm text-muted text-center">Nothing has been written yet.</p>}
        </div>
      )}
      {only !== "report" && (draft.slides || []).length > 0 && (
        <ol className="grid sm:grid-cols-2 gap-3">
          {draft.slides!.map((s, i) => (
            <li key={i} className="force-light bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-2 mb-1"><span className="text-[11px] text-muted">Slide {i + 2}</span>{s.image_id != null && <Badge tone="neutral">with picture</Badge>}</div>
              <div className="text-sm font-bold text-ink mb-1.5">{s.title}</div>
              <ul className="list-disc pl-5 text-xs text-ink space-y-0.5">{s.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export { plural };
