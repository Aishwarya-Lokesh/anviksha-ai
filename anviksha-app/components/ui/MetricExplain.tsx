"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Info } from "lucide-react";

export interface MetricBasis {
  sources?: string[];
  filters?: Record<string, any>;
  numerator?: number | null;
  denominator?: number | null;
  record_count?: number;
}

/**
 * The one shared "How is this calculated?" affordance (Part D1) every new
 * HOD Department Intelligence metric card/chart exposes. Small info icon
 * that reveals the deterministic `explanation` sentence plus the raw
 * `basis` the number was traced from — so no metric here is ever just an
 * unexplained figure.
 */
export function MetricExplain({
  explanation,
  basis,
  reasonUnavailable,
}: {
  explanation: string;
  basis?: MetricBasis;
  reasonUnavailable?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="How is this calculated?"
        className="text-muted hover:text-brand transition-colors"
      >
        <Info size={13} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute z-30 top-6 right-0 w-72 bg-white rounded-xl shadow-cardHover border border-gray-100 p-3.5 text-left"
          >
            <div className="text-[10px] font-semibold text-muted uppercase tracking-wide mb-1.5">How is this calculated?</div>
            <p className="text-xs text-ink leading-relaxed">{explanation}</p>
            {reasonUnavailable && <p className="text-xs text-muted italic mt-1.5">{reasonUnavailable}</p>}
            {basis && (
              <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-100 space-y-1">
                {basis.sources && basis.sources.length > 0 && (
                  <div className="text-[10px] text-muted">
                    <span className="font-semibold">Source data:</span> {basis.sources.join(", ")}
                  </div>
                )}
                {basis.numerator !== undefined && basis.numerator !== null && (
                  <div className="text-[10px] text-muted">
                    <span className="font-semibold">Numerator / denominator:</span> {basis.numerator} / {basis.denominator}
                  </div>
                )}
                {basis.record_count !== undefined && (
                  <div className="text-[10px] text-muted">
                    <span className="font-semibold">Records used:</span> {basis.record_count}
                  </div>
                )}
                {basis.filters && Object.keys(basis.filters).length > 0 && (
                  <div className="text-[10px] text-muted">
                    <span className="font-semibold">Filters:</span>{" "}
                    {Object.entries(basis.filters).map(([k, v]) => `${k}=${v}`).join(", ")}
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
