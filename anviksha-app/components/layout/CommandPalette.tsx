"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Clock, CornerDownLeft, Loader2, Search, SearchX, Zap } from "lucide-react";
import { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { NavItem } from "@/components/layout/Sidebar";

export const OPEN_SEARCH_EVENT = "anviksha:open-search";
export function openSearch() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

export type QuickAction = { label: string; href: string; keywords?: string };

type Row = { id: string; title: string; subtitle?: string | null; href: string; icon?: LucideIcon; recent?: string };
type Section = { label: string; rows: Row[] };

const RECENT_LIMIT = 5;

function loadRecent(key: string): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) || "[]");
    return Array.isArray(raw) ? raw.filter((r) => typeof r === "string").slice(0, RECENT_LIMIT) : [];
  } catch {
    return [];
  }
}

function saveRecent(key: string, query: string) {
  try {
    const next = [query, ...loadRecent(key).filter((r) => r.toLowerCase() !== query.toLowerCase())].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // storage unavailable — recent searches simply aren't remembered
  }
}

function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const index = text.toLowerCase().indexOf(q.toLowerCase());
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark className="bg-brand/15 text-brand rounded px-0.5">{text.slice(index, index + q.length)}</mark>
      {text.slice(index + q.length)}
    </>
  );
}

export function CommandPalette({
  role,
  navItems,
  quickActions,
}: {
  role: string;
  navItems: NavItem[];
  quickActions: QuickAction[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<{ key: string; label: string; items: any[] }[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);
  const recentKey = `anviksha_recent_search_${role}`;

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      // Cleared on close, not on open: by the time it is reopened the box is
      // already empty, so the first keystroke can never land on old text.
      setQuery("");
      setGroups([]);
      setActive(0);
      setFailed(false);
      return;
    }
    setRecent(loadRecent(recentKey));
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // autoFocus covers a fresh mount; this covers reopening while the previous
    // close animation is still playing, when the same input is reused.
    inputRef.current?.focus();
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, recentKey]);

  // Records come from the server, which decides what this role may see.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setGroups([]);
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      api.globalSearch(q)
        .then((res) => {
          if (seq !== requestSeq.current) return;
          setGroups(res.groups || []);
          setFailed(false);
        })
        .catch(() => {
          if (seq !== requestSeq.current) return;
          setGroups([]);
          setFailed(true);
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  const sections: Section[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (text: string) => text.toLowerCase().includes(q);
    const pages: Row[] = navItems
      .filter((n) => !q || matches(n.label))
      .map((n) => ({ id: `page-${n.key}`, title: n.label, href: n.href, icon: n.icon }));
    const actions: Row[] = quickActions
      .filter((a) => !q || matches(a.label) || matches(a.keywords || ""))
      .map((a, i) => ({ id: `action-${i}`, title: a.label, href: a.href, icon: Zap }));

    if (!q) {
      const out: Section[] = [];
      if (recent.length) {
        out.push({ label: "Recent searches", rows: recent.map((r, i) => ({ id: `recent-${i}`, title: r, href: "", icon: Clock, recent: r })) });
      }
      if (actions.length) out.push({ label: "Quick actions", rows: actions });
      out.push({ label: "Go to", rows: pages });
      return out;
    }
    const out: Section[] = [];
    if (actions.length) out.push({ label: "Quick actions", rows: actions });
    if (pages.length) out.push({ label: "Pages", rows: pages });
    for (const g of groups) {
      out.push({
        label: g.label,
        rows: g.items.map((item: any, i: number) => ({ id: `${g.key}-${i}`, title: item.title, subtitle: item.subtitle, href: item.href })),
      });
    }
    return out;
  }, [query, navItems, quickActions, groups, recent]);

  const flat = useMemo(() => sections.flatMap((s) => s.rows), [sections]);

  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const choose = (row: Row | undefined) => {
    if (!row) return;
    if (row.recent) {
      setQuery(row.recent);
      setActive(0);
      inputRef.current?.focus();
      return;
    }
    const q = query.trim();
    if (q.length >= 2) saveRecent(recentKey, q);
    close();
    router.push(row.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(flat[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  const typed = query.trim();
  const nothingFound = typed.length >= 2 && !loading && !failed && flat.length === 0;
  let index = -1;

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-3 pt-[8vh] sm:pt-[12vh]" role="dialog" aria-modal="true" aria-label="Search">
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-navy/50 backdrop-blur-xs" onClick={close} />
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="relative w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden flex flex-col max-h-[78vh]"
          >
            <div className="flex items-center gap-3 px-4 border-b border-gray-100">
              {loading ? <Loader2 size={18} className="text-brand animate-spin shrink-0" /> : <Search size={18} className="text-muted shrink-0" />}
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0); }}
                onKeyDown={onKeyDown}
                placeholder="Search pages, people, records…"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-palette-list"
                aria-activedescendant={flat[active] ? `cp-${flat[active].id}` : undefined}
                aria-label="Search"
                className="flex-1 min-w-0 h-14 text-[15px] text-ink placeholder:text-muted bg-transparent outline-none"
              />
              <button onClick={close} className="text-[11px] font-medium text-muted border border-gray-200 rounded-md px-1.5 py-0.5 hover:bg-gray-50 shrink-0">Esc</button>
            </div>

            <div ref={listRef} id="command-palette-list" role="listbox" className="overflow-y-auto p-2">
              {failed && (
                <div role="alert" className="px-3 py-6 text-center text-sm text-muted">Search isn't available right now. Pages and actions above still work.</div>
              )}
              {nothingFound && (
                <div className="px-3 py-8 text-center">
                  <SearchX size={24} className="text-muted mx-auto mb-2 opacity-60" />
                  <p className="text-sm font-medium text-ink">No results for "{typed}"</p>
                  <p className="text-xs text-muted mt-1">Try a name, a USN, a subject code or a page name.</p>
                </div>
              )}
              {sections.map((section) => (
                <div key={section.label} className="mb-1">
                  <div className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider uppercase text-muted">{section.label}</div>
                  {section.rows.map((row) => {
                    index += 1;
                    const i = index;
                    const Icon = row.icon || ArrowRight;
                    const isActive = i === active;
                    return (
                      <button
                        key={row.id}
                        id={`cp-${row.id}`}
                        data-index={i}
                        role="option"
                        aria-selected={isActive}
                        onMouseMove={() => setActive(i)}
                        onClick={() => choose(row)}
                        className={`w-full flex items-center gap-3 px-3 min-h-[44px] rounded-xl text-left transition-colors ${isActive ? "bg-brand-light" : "hover:bg-gray-50"}`}
                      >
                        <Icon size={16} className={`shrink-0 ${isActive ? "text-brand" : "text-muted"}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-ink truncate"><Highlight text={row.title} query={typed} /></span>
                          {row.subtitle && <span className="block text-xs text-muted truncate"><Highlight text={row.subtitle} query={typed} /></span>}
                        </span>
                        {isActive && <CornerDownLeft size={14} className="text-brand shrink-0 hidden sm:block" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="hidden sm:flex items-center gap-4 px-4 py-2 border-t border-gray-100 text-[11px] text-muted">
              <span><kbd className="font-sans border border-gray-200 rounded px-1">↑</kbd> <kbd className="font-sans border border-gray-200 rounded px-1">↓</kbd> to move</span>
              <span><kbd className="font-sans border border-gray-200 rounded px-1">Enter</kbd> to open</span>
              <span className="ml-auto">Results are limited to what your role can access</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
