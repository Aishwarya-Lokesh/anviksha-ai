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

function renderMarkdown(text: string) {
  const lines = text.split("\n");
  const blocks: JSX.Element[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushList = () => {
    if (!listItems.length) return;
    const key = `list-${blocks.length}`;
    if (listType === "ol") {
      blocks.push(
        <ol key={key} className="list-decimal pl-5 space-y-0.5">
          {listItems.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}
        </ol>
      );
    } else {
      blocks.push(
        <ul key={key} className="list-disc pl-5 space-y-0.5">
          {listItems.map((item, i) => <li key={i}>{renderInline(item, `${key}-${i}`)}</li>)}
        </ul>
      );
    }
    listItems = [];
    listType = null;
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trimEnd();
    const bulletMatch = /^\s*[-*]\s+(.*)/.exec(line);
    const numberedMatch = /^\s*\d+[.)]\s+(.*)/.exec(line);
    const headingMatch = /^\s*#{1,3}\s+(.*)/.exec(line);

    if (bulletMatch) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listItems.push(bulletMatch[1]);
      return;
    }
    if (numberedMatch) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listItems.push(numberedMatch[1]);
      return;
    }
    flushList();
    if (headingMatch) {
      blocks.push(<div key={`h-${index}`} className="font-semibold">{renderInline(headingMatch[1], `h-${index}`)}</div>);
    } else if (line.trim()) {
      blocks.push(<div key={`p-${index}`}>{renderInline(line, `p-${index}`)}</div>);
    } else {
      blocks.push(<div key={`sp-${index}`} className="h-2" />);
    }
  });
  flushList();
  return <div className="space-y-1">{blocks}</div>;
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

type ChartPayload = { type: "bar" | "donut"; title: string; data: { name: string; value: number }[] };
type Msg = { role: "user" | "ai"; text: string; downloadUrl?: string; downloadFilename?: string; chart?: ChartPayload };

export function ChatPanel({
  suggestions,
  askReal,
  initialQuestion,
}: {
  suggestions: string[];
  askReal?: (q: string) => Promise<{ answer: string; connected: boolean; download_url?: string; download_filename?: string; chart?: ChartPayload }>;
  initialQuestion?: string;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: "ai", text: "Hi! I'm Anviksha AI. Ask me anything about your academics, attendance, or documents." },
  ]);
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const sentInitialRef = useRef(false);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typing]);

  useEffect(() => {
    if (initialQuestion && !sentInitialRef.current) {
      sentInitialRef.current = true;
      send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const send = async (q: string) => {
    if (!q.trim()) return;
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setTyping(true);
    if (askReal) {
      try {
        const res = await askReal(q);
        setConnected(res.connected);
        setTyping(false);
        setMessages((m) => [...m, { role: "ai", text: res.answer, downloadUrl: res.download_url, downloadFilename: res.download_filename, chart: res.chart }]);
      } catch {
        setTyping(false);
        setMessages((m) => [...m, { role: "ai", text: "I couldn't reach the assistant just now. Please try again in a moment." }]);
      }
    } else {
      setTyping(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)]">
      {askReal && !connected && (
        <div className="text-xs bg-warning/10 text-[#9c6b12] rounded-xl p-2.5 mb-3 text-center">
          The AI assistant is unavailable right now. Please try again later.
        </div>
      )}
      <div className="flex-1 overflow-y-auto space-y-4 pr-2">
        <AnimatePresence initial={false}>
          {messages.map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 26 }}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`${m.chart ? "max-w-[92%] w-full" : "max-w-[70%]"} px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                  m.role === "user" ? "bg-brand text-white rounded-br-sm" : "bg-white border border-gray-100 shadow-card rounded-bl-sm text-ink"
                }`}
              >
                {m.role === "ai" ? renderMarkdown(m.text) : m.text}
                {m.downloadUrl && (
                  <a
                    href={`${API_BASE}${m.downloadUrl}`}
                    download={m.downloadFilename}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold bg-brand text-white px-3 py-1.5 rounded-full hover:bg-brand-dark transition-colors"
                  >
                    <Download size={13} /> Download {m.downloadFilename || "file"}
                  </a>
                )}
                {m.chart && (
                  <div className="mt-3 -mx-1">
                    <div className="text-xs font-semibold text-muted mb-1">{m.chart.title}</div>
                    {m.chart.type === "donut" ? (
                      <DonutChart data={m.chart.data} />
                    ) : (
                      <SimpleBarChart data={m.chart.data} xKey="name" barKey="value" showValues />
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {typing && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex justify-start">
            <div className="bg-white border border-gray-100 shadow-card rounded-2xl rounded-bl-sm px-4 py-3.5 flex gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.span
                  key={i}
                  className="w-2 h-2 rounded-full bg-brand/50"
                  animate={{ y: [0, -5, 0] }}
                  transition={{ repeat: Infinity, duration: 0.9, delay: i * 0.15 }}
                />
              ))}
            </div>
          </motion.div>
        )}
        <div ref={bottomRef} />
      </div>

      {messages.length <= 1 && (
        <div className="flex flex-wrap gap-2 py-3">
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => send(s)}
              className="text-xs bg-brand-light text-brand font-medium px-3 py-1.5 rounded-full hover:bg-brand/20 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send(input)}
          placeholder="Ask me anything..."
          className="flex-1 bg-gray-50 rounded-xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand/30 transition-shadow"
        />
        <button
          onClick={() => send(input)}
          className="bg-brand text-white px-4 py-3 rounded-xl hover:bg-brand-dark transition-colors"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
