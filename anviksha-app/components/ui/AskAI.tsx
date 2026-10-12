"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, Send, Download } from "lucide-react";
import { API_BASE } from "@/lib/api";
import { SimpleBarChart, DonutChart } from "@/components/charts/Charts";

// Lightweight, dependency-free markdown rendering for chat responses — the
// LLM's replies use a small, predictable vocabulary (bold, bullet/numbered
// lists, simple headings, inline code), so a small hand-rolled renderer
// avoids pulling in a full markdown library for this narrow need.
function renderInline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={`${keyPrefix}-${i}`} className="bg-black/5 rounded px-1 py-0.5 text-[0.85em]">{part.slice(1, -1)}</code>;
    }
    return <Fragment key={`${keyPrefix}-${i}`}>{part}</Fragment>;
  });
}

const EXAMPLES = [
  "Ask about your academics, attendance, profile and more...",
  "Try: What's my attendance in DBMS?",
  "Try: How many backlogs do I have?",
  "Try: Summarize the hostel refund policy",
];

export function AskAIBar({ onAsk }: { onAsk: (q: string) => void }) {
  const [placeholderIdx, setPlaceholderIdx] = useState(0);
  const [value, setValue] = useState("");

  useEffect(() => {
    const t = setInterval(() => setPlaceholderIdx((i) => (i + 1) % EXAMPLES.length), 2800);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      className="bg-gradient-to-r from-brand to-[#7A5FEA] rounded-2xl p-5 flex items-center gap-4 shadow-cardHover"
    >
      <div className="text-white flex-1">
        <div className="font-semibold text-sm mb-0.5">Ask Anviksha AI</div>
        <div className="flex items-center gap-3">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) {
                onAsk(value);
                setValue("");
              }
            }}
            placeholder={EXAMPLES[placeholderIdx]}
            className="w-full bg-white/15 placeholder-white/70 text-white text-sm rounded-xl px-4 py-2.5 outline-none focus:bg-white/25 transition-colors"
          />
          <button
            onClick={() => {
              if (value.trim()) {
                onAsk(value);
                setValue("");
              }
            }}
            className="bg-white text-brand text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-white/90 transition-colors shrink-0 flex items-center gap-1.5"
          >
            Ask Now <Send size={14} />
          </button>
        </div>
      </div>
      <div className="w-14 h-14 rounded-full bg-white/15 hidden sm:flex items-center justify-center shrink-0">
        <Bot size={28} className="text-white" />
      </div>
    </motion.div>
  );
}
