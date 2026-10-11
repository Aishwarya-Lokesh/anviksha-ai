"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Bell, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, API_BASE, getRole } from "@/lib/api";
import { openSearch } from "@/components/layout/CommandPalette";
import { useProfile } from "@/lib/useProfile";

function SearchTrigger() {
  const [mac, setMac] = useState(false);
  useEffect(() => { setMac(/Mac|iPhone|iPad/.test(navigator.platform)); }, []);
  return (
    <>
      <button
        onClick={openSearch}
        className="hidden md:flex items-center gap-2 w-72 lg:w-80 h-10 pl-3 pr-2 text-sm text-muted bg-gray-50 hover:bg-gray-100 rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <Search size={15} className="shrink-0" />
        <span className="flex-1 text-left truncate">Search pages, people, records…</span>
        <kbd className="font-sans text-[11px] border border-gray-200 bg-white rounded-md px-1.5 py-0.5">{mac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      <button
        onClick={openSearch}
        aria-label="Search"
        className="md:hidden w-11 h-11 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-colors"
      >
        <Search size={18} className="text-ink" />
      </button>
    </>
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
      <button onClick={openPanel} aria-label="Notifications" className="relative w-11 h-11 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-colors">
        <Bell size={18} className="text-ink" />
        {data.unread_count > 0 && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-1 -right-1 w-5 h-5 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {data.unread_count}
          </motion.span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white rounded-xl shadow-cardHover border border-gray-100 max-h-96 overflow-y-auto z-50">
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
  const profile = useProfile();
  return (
    <div className="sticky top-0 z-30 bg-white/70 backdrop-blur-md border-b border-gray-100 px-4 py-3 md:px-8 md:py-4 flex items-center justify-between gap-3 md:gap-4">
      <div className="min-w-0">
        <h1 className="text-lg md:text-xl font-bold text-ink truncate">{greeting}</h1>
        <p className="text-xs md:text-sm text-muted truncate">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <SearchTrigger />
        <NotificationBell />
        <Link
          href={`/${profile?.role || getRole() || "login"}${profile?.role || getRole() ? "/profile" : ""}`}
          aria-label="My profile"
          title={profile?.name || "My profile"}
          className="w-11 h-11 rounded-full bg-brand text-white flex items-center justify-center font-semibold shrink-0 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
        >
          {profile?.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`${API_BASE}${profile.photo_url}`} alt="" className="w-full h-full object-cover" />
          ) : (
            (profile?.name || avatarLetter).charAt(0).toUpperCase()
          )}
        </Link>
      </div>
    </div>
  );
}
