"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

const EMOJIS = ["🎉", "🏆", "⭐", "✨", "🥳", "🎊", "💫"];
const BASE_PIECE_COUNT = 40;
const BASE_DURATION_MS = 5000;
const DEFAULT_MESSAGE = "🏆 Excellent CGPA — keep it up!";

// Piece count and spawn spread both scale with duration, so a longer
// celebration (e.g. 10s) keeps emojis falling throughout instead of finishing
// early and leaving the overlay empty for the remainder.
function seededPieces(durationMs: number) {
  const count = Math.round(BASE_PIECE_COUNT * (durationMs / BASE_DURATION_MS));
  const spawnSpreadSeconds = (durationMs / 1000) * 0.75;
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
    left: Math.random() * 100,
    delay: Math.random() * spawnSpreadSeconds,
    duration: 2.6 + Math.random() * 1.8,
    size: 18 + Math.random() * 22,
    rotate: Math.random() * 360,
    drift: (Math.random() - 0.5) * 120,
  }));
}

/** Falling-emoji celebration, shown for `durationMs` when triggered by a
 * caller-controlled `active` flag. Fully self-contained: unmounts itself via
 * onDone, doesn't block page interaction. */
export function Celebration({
  active,
  onDone,
  durationMs = BASE_DURATION_MS,
  message = DEFAULT_MESSAGE,
}: {
  active: boolean;
  onDone: () => void;
  durationMs?: number;
  message?: string;
}) {
  const pieces = useMemo(() => (active ? seededPieces(durationMs) : []), [active, durationMs]);
  const [visible, setVisible] = useState(active);

  useEffect(() => {
    if (!active) return;
    setVisible(true);
    const t = setTimeout(() => {
      setVisible(false);
      onDone();
    }, durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, durationMs]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[100] pointer-events-none overflow-hidden"
        >
          {pieces.map((p) => (
            <motion.span
              key={p.id}
              initial={{ y: "-10vh", x: 0, opacity: 0, rotate: 0 }}
              animate={{ y: "110vh", x: p.drift, opacity: [0, 1, 1, 0], rotate: p.rotate }}
              transition={{ duration: p.duration, delay: p.delay, ease: "easeIn" }}
              style={{ position: "absolute", left: `${p.left}%`, fontSize: p.size, top: 0 }}
            >
              {p.emoji}
            </motion.span>
          ))}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute top-6 left-1/2 -translate-x-1/2 bg-white/95 shadow-cardHover rounded-2xl px-5 py-3 text-center"
          >
            <div className="text-sm font-bold text-ink">{message}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
