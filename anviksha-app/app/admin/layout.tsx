"use client";

import { useEffect, useState } from "react";
import { NavItem } from "@/components/layout/Sidebar";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, BookOpen, FileStack,
  ClipboardList, BarChart3, ListChecks, Bot, Briefcase,
} from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { key: "users", label: "Manage Users", short: "Users", href: "/admin/users", icon: UserCog },
  { key: "students", label: "Student Dataset", short: "Students", href: "/admin/datasets/students", icon: GraduationCap },
  { key: "faculty", label: "Faculty Dataset", short: "Faculty", href: "/admin/datasets/faculty", icon: Users },
  { key: "subjects", label: "Subject Dataset", href: "/admin/datasets/subjects", icon: BookOpen },
  { key: "placements", label: "Placement Analytics", href: "/admin/placements", icon: Briefcase },
  { key: "documents", label: "Document Requests", href: "/admin/documents", icon: FileStack },
  { key: "reports", label: "Reports & Statistics", href: "/admin/reports", icon: BarChart3 },
  { key: "logs", label: "Activity Logs", href: "/admin/logs", icon: ListChecks },
  { key: "assistant", label: "Ask Anviksha AI", href: "/admin/assistant", icon: Bot },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState("Administrator");

  useEffect(() => {
    api.me().then((d) => setMeta(d.email || "Administrator")).catch(() => {});
  }, []);

  return (
    <AppShell role="admin" roleLabel="Admin" navItems={navItems} userName="Admin" userMeta={meta}>
      {children}
    </AppShell>
  );
}
