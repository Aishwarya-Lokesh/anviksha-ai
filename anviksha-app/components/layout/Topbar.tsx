"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Bell, CheckCheck, Moon, Search, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

type Notice = { id: number; message: string; read: boolean; created_at: string | null; link: string };

// "5 min ago", "Yesterday", "12 Oct" — the server sends UTC without a zone mark.
export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(then.getTime())) return "";
  const minutes = Math.round((Date.now() - then.getTime()) / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const THEME_KEY = "anviksha_theme";

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains("dark")); }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // not remembered, still switches for this visit
    }
  };
  return (
    <button
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      aria-pressed={dark}
      className="w-11 h-11 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
    >
      {dark ? <Sun size={18} className="text-ink" /> : <Moon size={18} className="text-ink" />}
    </button>
  );
}

function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ unread_count: number; notifications: Notice[] }>({ unread_count: 0, notifications: [] });
  const ref = useRef<HTMLDivElement>(null);

  const load = () => api.myNotifications().then(setData).catch(() => {});

  useEffect(() => {
    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Opening the panel does not mark anything as read: a notice is read when
  // it is opened, or when "Mark all as read" is chosen.
  const openNotice = (n: Notice) => {
    setOpen(false);
    if (!n.read) {
      setData((d) => ({ unread_count: Math.max(0, d.unread_count - 1), notifications: d.notifications.map((x) => (x.id === n.id ? { ...x, read: true } : x)) }));
      api.markNotificationRead(n.id).catch(() => {});
    }
    if (n.link) router.push(n.link);
  };

  const markAll = () => {
    setData((d) => ({ unread_count: 0, notifications: d.notifications.map((x) => ({ ...x, read: true })) }));
    api.markAllNotificationsRead().catch(load);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setOpen(!open); if (!open) load(); }}
        aria-label={data.unread_count > 0 ? `Notifications, ${data.unread_count} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="relative w-11 h-11 rounded-full bg-gray-50 hover:bg-gray-100 flex items-center justify-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
      >
        <Bell size={18} className="text-ink" />
        {data.unread_count > 0 && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {data.unread_count > 99 ? "99+" : data.unread_count}
          </motion.span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Notifications"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="fixed sm:absolute top-[64px] sm:top-full inset-x-3 sm:inset-x-auto sm:right-0 sm:mt-2 sm:w-96 bg-white rounded-2xl shadow-cardHover border border-gray-100 z-50 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-ink">
                Notifications{data.unread_count > 0 && <span className="ml-2 text-xs font-medium text-muted">{data.unread_count} unread</span>}
              </div>
              {data.unread_count > 0 && (
                <button onClick={markAll} className="inline-flex items-center gap-1.5 min-h-[36px] px-2 text-xs font-semibold text-brand hover:underline outline-none focus-visible:ring-2 focus-visible:ring-brand/30 rounded-lg">
                  <CheckCheck size={14} /> Mark all as read
                </button>
              )}
            </div>
            {data.notifications.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <div className="w-11 h-11 rounded-2xl bg-brand-light flex items-center justify-center mx-auto mb-3"><Bell size={20} className="text-brand" /></div>
                <p className="text-sm font-medium text-ink">You're all caught up</p>
                <p className="text-xs text-muted mt-1">New announcements, deadlines and updates will appear here.</p>
              </div>
            ) : (
              <ul className="max-h-[min(26rem,calc(100vh-9rem))] overflow-y-auto divide-y divide-gray-100">
                {data.notifications.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openNotice(n)}
                      className={`w-full text-left px-4 py-3 flex gap-3 items-start hover:bg-gray-50 outline-none focus-visible:bg-gray-50 ${n.read ? "" : "bg-brand-50"}`}
                    >
                      <span aria-hidden className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${n.read ? "bg-transparent" : "bg-brand"}`} />
                      <span className="min-w-0 flex-1">
                        <span className={`block text-sm text-ink ${n.read ? "" : "font-semibold"}`}>{n.message}</span>
                        <span className="block text-xs text-muted mt-0.5">{timeAgo(n.created_at)}{n.read ? "" : " · Unread"}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
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
        <ThemeToggle />
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
