"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, LogOut, Menu, X, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { clearAuth } from "@/lib/api";

// `short` is the label used in the mobile bottom bar, where there is room for one word.
export type NavItem = { key: string; label: string; short?: string; href: string; icon: LucideIcon };

const COLLAPSED_KEY = "anviksha_sidebar_collapsed";
// How many destinations sit directly in the mobile bottom bar; the rest live in the drawer.
const BOTTOM_NAV_COUNT = 4;

// The dashboard root ("/student") must only match exactly, otherwise it would
// stay highlighted on every nested page.
function isActive(pathname: string, href: string, rootHref: string) {
  if (href === rootHref) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function Brand({ compact }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center shrink-0 shadow-[0_4px_14px_rgba(91,63,217,0.35)]">
        <Sparkles size={18} />
      </div>
      {!compact && (
        <div className="min-w-0">
          <div className="font-display font-bold text-[15px] tracking-wide leading-none">ANVIKSHA AI</div>
          <div className="text-[10px] text-white/45 mt-1 tracking-wide truncate">Academic Intelligence Assistant</div>
        </div>
      )}
    </div>
  );
}

function NavList({
  navItems,
  pathname,
  compact,
  layoutId,
  onNavigate,
}: {
  navItems: NavItem[];
  pathname: string;
  compact?: boolean;
  layoutId: string;
  onNavigate?: () => void;
}) {
  const rootHref = navItems[0]?.href ?? "/";
  return (
    <nav aria-label="Main" className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
      {navItems.map((item) => {
        const active = isActive(pathname, item.href, rootHref);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={item.href}
            onClick={onNavigate}
            title={compact ? item.label : undefined}
            aria-label={compact ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            className="relative block rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {active && (
              <motion.div
                layoutId={layoutId}
                className="absolute inset-0 bg-brand rounded-xl shadow-[0_4px_14px_rgba(91,63,217,0.35)]"
                transition={{ type: "spring", stiffness: 420, damping: 36 }}
              />
            )}
            <div
              className={`relative z-10 flex items-center gap-3 min-h-[44px] rounded-xl text-sm font-medium transition-colors duration-200 ${
                compact ? "justify-center px-0" : "px-3.5"
              } ${active ? "text-white" : "text-white/55 hover:text-white hover:bg-white/[0.06]"}`}
            >
              <Icon size={17} strokeWidth={active ? 2.25 : 2} className="shrink-0" />
              {!compact && <span className="truncate">{item.label}</span>}
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

function UserFooter({
  userName,
  userMeta,
  compact,
  onLogout,
}: {
  userName: string;
  userMeta: string;
  compact?: boolean;
  onLogout: () => void;
}) {
  return (
    <div className="p-3">
      <div className={`bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 flex items-center gap-3 mb-1 ${compact ? "justify-center px-0" : ""}`}>
        <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-sm font-bold shrink-0 shadow-[0_2px_8px_rgba(91,63,217,0.4)]">
          {userName.charAt(0).toUpperCase()}
        </div>
        {!compact && (
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{userName}</div>
            <div className="text-[11px] text-white/45 truncate">{userMeta}</div>
          </div>
        )}
      </div>
      <button
        onClick={onLogout}
        title={compact ? "Log out" : undefined}
        aria-label="Log out"
        className={`w-full flex items-center gap-2 min-h-[44px] text-xs text-white/55 hover:text-white rounded-lg hover:bg-white/[0.04] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
          compact ? "justify-center" : "px-3"
        }`}
      >
        <LogOut size={14} /> {!compact && "Log out"}
      </button>
    </div>
  );
}

export function Sidebar({
  navItems,
  userName,
  userMeta,
  roleLabel,
}: {
  navItems: NavItem[];
  userName: string;
  userMeta: string;
  roleLabel: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // storage unavailable (private mode) — the sidebar simply starts expanded
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
      } catch {
        // not persisted, still toggles for this visit
      }
      return !c;
    });
  };

  // Navigating to a new page always closes the drawer.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [drawerOpen]);

  const handleLogout = () => {
    clearAuth();
    router.push("/");
  };

  const rootHref = navItems[0]?.href ?? "/";
  const bottomItems = navItems.slice(0, BOTTOM_NAV_COUNT);
  const activeInDrawerOnly = navItems
    .slice(BOTTOM_NAV_COUNT)
    .some((item) => isActive(pathname, item.href, rootHref));

  return (
    <>
      {/* Desktop: collapsible sidebar */}
      <aside
        className={`hidden lg:flex shrink-0 h-screen sticky top-0 bg-gradient-to-b from-navy to-navy-light text-white flex-col transition-[width] duration-200 ease-smooth ${
          collapsed ? "w-[76px]" : "w-64"
        }`}
      >
        <div className={`py-5 flex items-center gap-2 ${collapsed ? "flex-col px-2" : "px-5 justify-between"}`}>
          <Brand compact={collapsed} />
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center text-white/55 hover:text-white hover:bg-white/[0.06] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        </div>
        <NavList navItems={navItems} pathname={pathname} compact={collapsed} layoutId="sidebar-active" />
        <UserFooter userName={userName} userMeta={userMeta} compact={collapsed} onLogout={handleLogout} />
      </aside>

      {/* Mobile / tablet: bottom navigation */}
      <nav
        aria-label="Primary"
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white/95 backdrop-blur-md border-t border-gray-200 pb-[env(safe-area-inset-bottom)]"
      >
        <div className="grid grid-cols-5">
          {bottomItems.map((item) => {
            const active = isActive(pathname, item.href, rootHref);
            const Icon = item.icon;
            return (
              <Link
                key={item.key}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 min-h-[56px] px-1 text-[10px] font-medium outline-none focus-visible:bg-brand-light ${
                  active ? "text-brand" : "text-muted"
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.4 : 2} />
                <span className="truncate max-w-full">{item.short ?? item.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            className={`flex flex-col items-center justify-center gap-1 min-h-[56px] px-1 text-[10px] font-medium outline-none focus-visible:bg-brand-light ${
              activeInDrawerOnly ? "text-brand" : "text-muted"
            }`}
          >
            <Menu size={20} strokeWidth={activeInDrawerOnly ? 2.4 : 2} />
            <span>Menu</span>
          </button>
        </div>
      </nav>

      {/* Mobile / tablet: slide-out drawer with the full menu */}
      <AnimatePresence>
        {drawerOpen && (
          <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={`${roleLabel} menu`}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-navy/60"
              onClick={() => setDrawerOpen(false)}
            />
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 380, damping: 38 }}
              className="absolute inset-y-0 left-0 w-[84%] max-w-[320px] bg-gradient-to-b from-navy to-navy-light text-white flex flex-col shadow-2xl"
            >
              <div className="px-5 py-5 flex items-center justify-between gap-2">
                <Brand />
                <button
                  onClick={() => setDrawerOpen(false)}
                  aria-label="Close menu"
                  className="w-11 h-11 shrink-0 rounded-lg flex items-center justify-center text-white/70 hover:text-white hover:bg-white/[0.06] outline-none focus-visible:ring-2 focus-visible:ring-white/70"
                >
                  <X size={20} />
                </button>
              </div>
              <NavList
                navItems={navItems}
                pathname={pathname}
                layoutId="drawer-active"
                onNavigate={() => setDrawerOpen(false)}
              />
              <UserFooter userName={userName} userMeta={userMeta} onLogout={handleLogout} />
            </motion.aside>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
