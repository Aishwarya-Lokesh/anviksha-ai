"use client";

import { NavItem } from "@/components/layout/Sidebar";
import { AppShell } from "@/components/layout/AppShell";
import type { QuickAction } from "@/components/layout/CommandPalette";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, BookOpen, FileStack,
  ClipboardList, BarChart3, ListChecks, Bot, Briefcase, UserCircle
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
  { key: "profile", label: "My Profile", href: "/admin/profile", icon: UserCircle },
];

const quickActions: QuickAction[] = [
  { label: "Add a student", href: "/admin/users?action=add-student", keywords: "new create user" },
  { label: "Add a faculty member", href: "/admin/users?action=add-faculty", keywords: "new create teacher" },
  { label: "Review document requests", href: "/admin/documents", keywords: "approve reject bonafide" },
  { label: "Run a report", href: "/admin/reports", keywords: "statistics query export" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="admin" roleLabel="Admin" navItems={navItems} quickActions={quickActions}>
      {children}
    </AppShell>
  );
}
