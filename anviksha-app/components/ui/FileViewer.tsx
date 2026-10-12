"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, FileWarning, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { CenterModal } from "@/components/ui/Modal";

/** "pdf" | "image" | "other", from the file name (ignoring the link's query string). */
export function fileKind(url: string): "pdf" | "image" | "other" {
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".pdf")) return "pdf";
  if (/\.(png|jpe?g|webp|gif)$/.test(path)) return "image";
  return "other";
}

export function fileName(url: string): string {
  try {
    return decodeURIComponent(url.split("?")[0].split("/").pop() || "file");
  } catch {
    return url.split("?")[0].split("/").pop() || "file";
  }
}

type State =
  | { status: "loading" }
  | { status: "ready"; objectUrl: string }
  | { status: "error"; message: string };

/**
 * Shows a stored image or PDF inside the app, with Download and Open-in-new-tab.
 * The file is fetched once and shown from memory, so a missing or expired file
 * produces a clear message here instead of a blank frame or a browser error page.
 */
export function FileViewer({ url, title }: { url: string; title?: string }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const kind = fileKind(url);
  const name = fileName(url);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setState({ status: "loading" });
    fetch(`${API_BASE}${url}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            res.status === 404 ? "This file is no longer available. Upload it again to replace it."
              : res.status === 403 ? "This link has expired. Close this window and open the file again."
              : "The file could not be loaded. Please try again."
          );
        }
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setState({ status: "ready", objectUrl });
      })
      .catch((e) => {
        if (!cancelled) setState({ status: "error", message: e?.message?.includes("fetch") ? "The file could not be loaded. Check your connection and try again." : e.message });
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, attempt]);

  if (state.status === "loading") {
    return (
      <div className="h-64 flex flex-col items-center justify-center gap-2 text-sm text-muted" role="status">
        <Loader2 size={22} className="animate-spin text-brand" /> Loading file…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div role="alert" className="py-10 text-center">
        <FileWarning size={28} className="text-danger mx-auto mb-2" />
        <p className="text-sm text-ink max-w-xs mx-auto">{state.message}</p>
        <button onClick={() => setAttempt((a) => a + 1)} className="mt-4 min-h-[44px] px-4 rounded-xl bg-brand-light text-brand text-sm font-semibold hover:bg-brand/20">
          Try again
        </button>
      </div>
    );
  }

  const actionClass = "inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl text-sm font-semibold transition-colors";
  return (
    <div className="space-y-3">
      {kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={state.objectUrl} alt={title || name} className="w-full max-h-[65vh] object-contain rounded-xl border border-gray-200 bg-gray-50" />
      ) : kind === "pdf" ? (
        <>
          {/* Phones generally cannot show a PDF inside a page; they get the two buttons below. */}
          <iframe src={state.objectUrl} title={title || name} className="hidden sm:block w-full h-[65vh] rounded-xl border border-gray-200" />
          <p className="sm:hidden text-sm text-muted text-center py-6">PDF ready. Open it or download it below.</p>
        </>
      ) : (
        <p className="text-sm text-muted text-center py-6">This file type can't be previewed. Download it to open it.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <a href={state.objectUrl} download={name} className={`${actionClass} bg-brand text-white hover:bg-brand-dark flex-1`}>
          <Download size={15} /> Download
        </a>
        <a href={state.objectUrl} target="_blank" rel="noreferrer" className={`${actionClass} bg-brand-light text-brand hover:bg-brand/20 flex-1`}>
          <ExternalLink size={15} /> Open in new tab
        </a>
      </div>
    </div>
  );
}

/** The viewer in a dialog, for pages that just need "open this file". */
export function FileViewerModal({ file, onClose }: { file: { url: string; title: string } | null; onClose: () => void }) {
  return (
    <CenterModal open={!!file} onClose={onClose} title={file?.title || ""}>
      {file && <FileViewer url={file.url} title={file.title} />}
    </CenterModal>
  );
}
