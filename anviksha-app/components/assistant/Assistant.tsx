"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Bot, History, Loader2, MessageSquarePlus, Send, Sparkles, Square, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Drawer } from "@/components/ui/Modal";
import { Markdown } from "@/components/ui/Markdown";
import { DonutChart, SimpleBarChart } from "@/components/charts/Charts";
import { api } from "@/lib/api";

type Chart = { type: "bar" | "donut"; title: string; data: { name: string; value: number }[] };
type Message = { role: "user" | "assistant"; content: string; charts?: Chart[]; failed?: boolean };
type Conversation = { id: number; title: string; updated_at: string | null };

const SUBTITLE: Record<string, string> = {
  student: "Answers come from your own records",
  teacher: "Answers come from your own classes and work",
  hod: "Answers come from your department's records",
  admin: "Answers come from the platform's records",
};

function ConversationList({ items, activeId, onOpen, onDelete, onNew }: {
  items: Conversation[] | null; activeId: number | null; onOpen: (id: number) => void; onDelete: (id: number) => void; onNew: () => void;
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <button onClick={onNew} className="flex items-center justify-center gap-2 min-h-[44px] rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-dark mb-3">
        <MessageSquarePlus size={15} /> New chat
      </button>
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1">
        {items === null && <p className="text-xs text-muted text-center py-6">Loading…</p>}
        {items !== null && items.length === 0 && <p className="text-xs text-muted text-center py-6">Your earlier chats will appear here.</p>}
        {(items || []).map((c) => (
          <div key={c.id} className={`group flex items-center rounded-xl ${c.id === activeId ? "bg-brand-light" : "hover:bg-gray-100"}`}>
            <button onClick={() => onOpen(c.id)} className="flex-1 min-w-0 text-left px-3 py-2 min-h-[44px]">
              <span className={`block text-sm truncate ${c.id === activeId ? "text-brand font-semibold" : "text-ink"}`}>{c.title}</span>
              {c.updated_at && <span className="block text-[11px] text-muted">{c.updated_at.slice(0, 10)}</span>}
            </button>
            <button onClick={() => onDelete(c.id)} aria-label={`Delete chat: ${c.title}`} className="w-11 h-11 flex items-center justify-center text-muted hover:text-danger shrink-0">
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Assistant({ role }: { role: "student" | "teacher" | "hod" | "admin" }) {
  const initialQuestion = useSearchParams().get("q");
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [starters, setStarters] = useState<string[]>([]);
  const [available, setAvailable] = useState(true);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [loadingChat, setLoadingChat] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const askedInitial = useRef(false);

  const refreshList = () => api.assistantConversations().then(setConversations).catch(() => setConversations((c) => c ?? []));

  useEffect(() => {
    api.assistantStarters().then((d) => { setStarters(d.starters || []); setAvailable(d.available !== false); }).catch(() => {});
    refreshList();
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: streaming ? "auto" : "smooth", block: "end" });
  }, [messages, status, streaming]);

  const send = async (raw: string) => {
    const text = raw.trim();
    if (!text || streaming) return;
    setInput("");
    setStatus("");
    setStreaming(true);
    setMessages((m) => [...m, { role: "user", content: text }, { role: "assistant", content: "", charts: [] }]);
    const patchLast = (change: (m: Message) => Message) => setMessages((all) => all.map((m, i) => (i === all.length - 1 ? change(m) : m)));
    const controller = new AbortController();
    abortRef.current = controller;
    let startedId: number | null = null;
    let finished = false;
    try {
      await api.assistantChat({ message: text, conversation_id: activeId }, (event, data) => {
        if (event === "start") { startedId = data.conversation_id; setActiveId(data.conversation_id); }
        else if (event === "status") setStatus(data.text);
        else if (event === "text") { setStatus(""); patchLast((m) => ({ ...m, content: m.content + data.text })); }
        else if (event === "chart") patchLast((m) => ({ ...m, charts: [...(m.charts || []), data.chart] }));
        else if (event === "done") { finished = true; if (data.available === false) setAvailable(false); }
      }, controller.signal);
      // The connection can close before the reply is complete. What arrived is
      // kept, and the reader is told it is incomplete.
      if (!finished) patchLast((m) => ({ ...m, failed: true, content: (m.content ? m.content + "\n\n" : "") + "*The reply was cut off before it finished. Please ask again.*" }));
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        patchLast((m) => ({ ...m, failed: true, content: m.content || e?.detail || "I couldn't reach the assistant just now. Please try again." }));
      } else {
        patchLast((m) => ({ ...m, content: m.content || "Stopped." }));
      }
    }
    setStatus("");
    setStreaming(false);
    abortRef.current = null;
    if (startedId !== null) refreshList();
    inputRef.current?.focus();
  };

  // A question passed in the address (from a dashboard's "Ask" box) is asked once.
  useEffect(() => {
    if (initialQuestion && !askedInitial.current) {
      askedInitial.current = true;
      send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  const openChat = async (id: number) => {
    if (streaming) return;
    setHistoryOpen(false);
    setLoadingChat(true);
    try {
      const chat = await api.assistantConversation(id);
      setActiveId(id);
      setMessages(chat.messages.map((m: any) => ({ role: m.role, content: m.content, charts: m.charts || [] })));
    } catch {
      setMessages([{ role: "assistant", content: "That chat could not be opened. Please try again.", failed: true }]);
    }
    setLoadingChat(false);
  };

  const newChat = () => {
    if (streaming) abortRef.current?.abort();
    setHistoryOpen(false);
    setActiveId(null);
    setMessages([]);
    setStatus("");
    inputRef.current?.focus();
  };

  const deleteChat = async (id: number) => {
    try {
      await api.deleteAssistantConversation(id);
      setConversations((list) => (list || []).filter((c) => c.id !== id));
      if (id === activeId) newChat();
    } catch {
      // the chat stays in the list; nothing was removed
    }
  };

  const list = <ConversationList items={conversations} activeId={activeId} onOpen={openChat} onDelete={deleteChat} onNew={newChat} />;
  const empty = messages.length === 0 && !loadingChat;

  return (
    <>
      <Topbar greeting="Ask Anviksha AI" subtitle={SUBTITLE[role]} avatarLetter="A" />
      <div className="flex h-[calc(100dvh-65px-56px)] lg:h-[calc(100dvh-77px)]">
        <aside className="hidden lg:flex w-72 shrink-0 border-r border-gray-100 bg-white p-4 flex-col min-h-0">{list}</aside>

        <section className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="lg:hidden flex items-center gap-2 px-4 py-2 border-b border-gray-100 bg-white">
            <button onClick={() => setHistoryOpen(true)} className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl bg-gray-100 text-sm font-medium text-ink"><History size={15} /> Chats</button>
            <button onClick={newChat} className="inline-flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl bg-brand-light text-sm font-medium text-brand"><MessageSquarePlus size={15} /> New</button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-8 py-5" aria-live="polite">
            {!available && (
              <div role="status" className="max-w-3xl mx-auto mb-4 text-sm bg-warning/10 text-[#7a5410] rounded-xl p-3 text-center">
                The assistant isn't available right now. Please try again later.
              </div>
            )}
            {loadingChat && <p className="text-sm text-muted text-center py-10">Opening chat…</p>}
            {empty && (
              <div className="max-w-2xl mx-auto text-center pt-6 md:pt-14">
                <div className="w-14 h-14 rounded-2xl bg-brand-light flex items-center justify-center mx-auto mb-4"><Sparkles size={24} className="text-brand" /></div>
                <h2 className="text-lg font-bold font-display text-ink">How can I help?</h2>
                <p className="text-sm text-muted mt-1 mb-6">I look things up in the records you're allowed to see. If something isn't recorded, I'll say so.</p>
                <div className="grid sm:grid-cols-2 gap-2 text-left">
                  {starters.map((s) => (
                    <button key={s} onClick={() => send(s)} disabled={streaming} className="min-h-[52px] px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-sm text-ink hover:border-brand/50 hover:bg-brand-light/40 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="max-w-3xl mx-auto space-y-4">
              {messages.map((m, i) => {
                const isLast = i === messages.length - 1;
                const waiting = m.role === "assistant" && isLast && streaming && !m.content && !(m.charts || []).length;
                return (
                  <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    {m.role === "assistant" && <div className="w-8 h-8 rounded-xl bg-brand-light flex items-center justify-center shrink-0 mt-0.5"><Bot size={16} className="text-brand" /></div>}
                    <div className={`min-w-0 text-sm rounded-2xl px-4 py-3 ${m.role === "user" ? "bg-brand text-white rounded-br-md max-w-[85%] whitespace-pre-wrap break-words" : `bg-white border ${m.failed ? "border-danger/30" : "border-gray-100"} shadow-card rounded-bl-md text-ink flex-1 max-w-full`}`}>
                      {m.role === "user" ? m.content : waiting ? (
                        <span className="inline-flex items-center gap-2 text-muted"><Loader2 size={14} className="animate-spin" /> {status || "Thinking…"}</span>
                      ) : (
                        <>
                          <Markdown text={m.content} />
                          {(m.charts || []).map((c, ci) => (
                            <figure key={ci} className="mt-3">
                              <figcaption className="text-xs font-semibold text-muted mb-1">{c.title}</figcaption>
                              {c.type === "donut" ? <DonutChart data={c.data} /> : <SimpleBarChart data={c.data} xKey="name" barKey="value" showValues />}
                            </figure>
                          ))}
                          {isLast && streaming && status && <p className="mt-2 inline-flex items-center gap-2 text-xs text-muted"><Loader2 size={12} className="animate-spin" /> {status}</p>}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <div ref={bottomRef} />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(input); }}
            className="border-t border-gray-100 bg-white px-4 md:px-8 py-3"
          >
            <div className="max-w-3xl mx-auto flex items-end gap-2">
              <label htmlFor="assistant-input" className="sr-only">Your question</label>
              <textarea
                id="assistant-input"
                ref={inputRef}
                rows={1}
                value={input}
                maxLength={4000}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                placeholder="Ask a question…"
                className="flex-1 resize-none max-h-40 min-h-[48px] rounded-xl bg-gray-50 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
              {streaming ? (
                <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop" className="w-12 h-12 rounded-xl bg-gray-900 text-white flex items-center justify-center shrink-0"><Square size={15} /></button>
              ) : (
                <button type="submit" disabled={!input.trim()} aria-label="Send" className="w-12 h-12 rounded-xl bg-brand text-white flex items-center justify-center shrink-0 hover:bg-brand-dark disabled:opacity-40"><Send size={16} /></button>
              )}
            </div>
            <p className="max-w-3xl mx-auto text-[11px] text-muted mt-1.5 hidden sm:block">Enter to send · Shift + Enter for a new line · Check important figures against the source page.</p>
          </form>
        </section>
      </div>

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Your chats">
        <div className="h-[70vh]">{list}</div>
      </Drawer>
    </>
  );
}
