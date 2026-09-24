"use client";

import { Sidebar, NavItem } from "@/components/layout/Sidebar";
import { AuthGuard } from "@/components/ui/AuthGuard";
import {
  LayoutDashboard, Users, GraduationCap, UserCog, BookOpen, FileStack,
  ClipboardList, BarChart3, ListChecks, Bot, Briefcase,
} from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { key: "users", label: "Manage Users", href: "/admin/users", icon: UserCog },
  { key: "students", label: "Student Dataset", href: "/admin/datasets/students", icon: GraduationCap },
  { key: "faculty", label: "Faculty Dataset", href: "/admin/datasets/faculty", icon: Users },
  { key: "subjects", label: "Subject Dataset", href: "/admin/datasets/subjects", icon: BookOpen },
  { key: "placements", label: "Placement Analytics", href: "/admin/placements", icon: Briefcase },
  { key: "documents", label: "Document Requests", href: "/admin/documents", icon: FileStack },
  { key: "reports", label: "Reports & Statistics", href: "/admin/reports", icon: BarChart3 },
  { key: "logs", label: "Activity Logs", href: "/admin/logs", icon: ListChecks },
  { key: "assistant", label: "Ask Anviksha AI", href: "/admin/assistant", icon: Bot },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard requiredRole="admin">
      <div className="flex bg-surface min-h-screen">
        <Sidebar navItems={navItems} userName="Admin" userMeta="Super Administrator" roleLabel="Admin" />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </AuthGuard>
  );
}
