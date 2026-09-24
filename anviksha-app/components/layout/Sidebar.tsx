"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, LogOut } from "lucide-react";
import { LucideIcon } from "lucide-react";
import { clearAuth } from "@/lib/api";

export type NavItem = { key: string; label: string; href: string; icon: LucideIcon };

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

  const handleLogout = () => {
    clearAuth();
    router.push("/");
  };

  return (
    <aside className="w-64 shrink-0 h-screen sticky top-0 bg-gradient-to-b from-navy to-navy-light text-white flex flex-col">
      <div className="px-5 py-6 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center shrink-0 shadow-[0_4px_14px_rgba(91,63,217,0.35)]">
          <Sparkles size={18} />
        </div>
        <div>
          <div className="font-display font-bold text-[15px] tracking-wide leading-none">ANVIKSHA AI</div>
          <div className="text-[10px] text-white/45 mt-1 tracking-wide">Academic Intelligence Assistant</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          return (
            <Link key={item.key} href={item.href} className="relative block">
              {active && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-brand rounded-xl shadow-[0_4px_14px_rgba(91,63,217,0.35)]"
                  transition={{ type: "spring", stiffness: 420, damping: 36 }}
                />
              )}
              <div className={`relative z-10 flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors duration-200 ${active ? "text-white" : "text-white/55 hover:text-white hover:bg-white/[0.06]"}`}>
                <Icon size={17} strokeWidth={active ? 2.25 : 2} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-3">
        <div className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-full bg-brand flex items-center justify-center text-sm font-bold shrink-0 shadow-[0_2px_8px_rgba(91,63,217,0.4)]">
            {userName.charAt(0)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{userName}</div>
            <div className="text-[11px] text-white/45 truncate">{userMeta}</div>
          </div>
        </div>
        <button onClick={handleLogout} className="w-full flex items-center gap-2 text-xs text-white/45 hover:text-white px-3 py-2 rounded-lg hover:bg-white/[0.04] transition-colors">
          <LogOut size={14} /> Log out
        </button>
      </div>
    </aside>
  );
}
