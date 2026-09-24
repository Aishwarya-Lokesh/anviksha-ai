"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Bell, Search, Loader2, FileText, Users, BookOpen, GraduationCap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

function useDebounce(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const debounced = useDebounce(query, 350);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!debounced.trim()) { setResults(null); return; }
    setLoading(true);
    api.globalSearch(debounced)
      .then((r) => setResults(r))
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [debounced]);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const iconFor: Record<string, any> = { students: GraduationCap, faculty: Users, subjects: BookOpen, documents: FileText };

  return (
    <div ref={ref} className="relative w-80 hidden md:block">
      <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
      <input
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search students, faculty, subjects..."
        className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-brand/30 transition-shadow"
      />
      <AnimatePresence>
        {open && query.trim() && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="absolute top-full mt-2 left-0 right-0 bg-white rounded-xl shadow-cardHover border border-gray-100 max-h-96 overflow-y-auto z-50"
          >
            {loading ? (
              <div className="p-4 flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" /> Searching real data...</div>
            ) : !results || results.total_results === 0 ? (
              <div className="p-4 text-sm text-muted">No results for "{query}"</div>
            ) : (
              Object.entries(results.results).map(([category, items]: [string, any]) => {
                if (!items || items.length === 0) return null;
                const Icon = iconFor[category] || FileText;
                return (
                  <div key={category} className="p-2">
                    <div className="text-[10px] font-semibold text-muted uppercase px-2 py-1">{category}</div>
                    {items.map((item: any, i: number) => (
                      <div key={i} className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-gray-50 text-sm">
                        <Icon size={14} className="text-brand shrink-0" />
                        <span className="text-ink truncate">{item.name || item.type}</span>
                        {item.usn && <span className="text-xs text-muted ml-auto shrink-0">{item.usn}</span>}
                        {item.status && <span className="text-xs text-muted ml-auto shrink-0">{item.status}</span>}
                      </div>
                    ))}
                  </div>
                );
              })
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>({ unread_count: 0, notifications: [] });
  const ref = useRef<HTMLDivElement>(null);

  const load = () => api.myNotifications().then(setData).catch(() => {});

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const openPanel = async () => {
    setOpen(!open);
    if (!open && data.unread_count > 0) {
      await api.markAllNotificationsRead().catch(() => {});
      setTimeout(load, 300);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={openPanel} className="relative w-10 h-10 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-colors">
        <Bell size={18} className="text-ink" />
        {data.unread_count > 0 && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-1 -right-1 w-5 h-5 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {data.unread_count}
          </motion.span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="absolute top-full right-0 mt-2 w-80 bg-white rounded-xl shadow-cardHover border border-gray-100 max-h-96 overflow-y-auto z-50">
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-ink">Notifications</div>
            {data.notifications.length === 0 ? (
              <div className="p-4 text-sm text-muted">No notifications yet.</div>
            ) : (
              data.notifications.map((n: any) => (
                <div key={n.id} className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50">
                  <div className="text-sm text-ink">{n.message}</div>
                  <div className="text-xs text-muted mt-0.5">{n.created_at}</div>
                </div>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Topbar({
  greeting,
  subtitle,
  avatarLetter,
}: {
  greeting: string;
  subtitle: string;
  avatarLetter: string;
}) {
  return (
    <div className="sticky top-0 z-30 bg-white/70 backdrop-blur-md border-b border-gray-100 px-8 py-4 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold text-ink truncate">{greeting}</h1>
        <p className="text-sm text-muted truncate">{subtitle}</p>
      </div>
      <div className="flex items-center gap-4 shrink-0">
        <GlobalSearch />
        <NotificationBell />
        <div className="w-10 h-10 rounded-full bg-brand text-white flex items-center justify-center font-semibold">
          {avatarLetter}
        </div>
      </div>
    </div>
  );
}
