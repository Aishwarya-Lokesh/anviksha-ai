"use client";

import { Sidebar, NavItem } from "@/components/layout/Sidebar";
import { AuthGuard } from "@/components/ui/AuthGuard";
import {
  LayoutDashboard, User, TrendingUp, CalendarCheck, Award, FileText,
  BookOpen, HeartHandshake, Bot, Briefcase,
} from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/student", icon: LayoutDashboard },
  { key: "profile", label: "My Profile", href: "/student/profile", icon: User },
  { key: "rank", label: "Class Rank", href: "/student/rank", icon: TrendingUp },
  { key: "attendance", label: "Attendance", href: "/student/attendance", icon: CalendarCheck },
  { key: "achievements", label: "Achievements", href: "/student/achievements", icon: Award },
  { key: "placement", label: "Placement", href: "/student/placement", icon: Briefcase },
  { key: "resume", label: "Resume Builder", href: "/student/resume", icon: FileText },
  { key: "documents", label: "Document Requests", href: "/student/documents", icon: FileText },
  { key: "notes", label: "Notes & Deadlines", href: "/student/notes", icon: BookOpen },
  { key: "counseling", label: "Counseling", href: "/student/counseling", icon: HeartHandshake },
  { key: "assistant", label: "Ask Anviksha AI", href: "/student/assistant", icon: Bot },
];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard requiredRole="student">
      <div className="flex bg-surface min-h-screen">
        <Sidebar navItems={navItems} userName="Student" userMeta="Logged in" roleLabel="Student" />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </AuthGuard>
  );
}
