"use client";

import { NavItem } from "@/components/layout/Sidebar";
import { AppShell } from "@/components/layout/AppShell";
import type { QuickAction } from "@/components/layout/CommandPalette";
import {
  LayoutDashboard, User, TrendingUp, CalendarCheck, Award, FileText,
  BookOpen, HeartHandshake, Bot, Briefcase, MessageSquareQuote,
} from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/student", icon: LayoutDashboard },
  { key: "profile", label: "My Profile", short: "Profile", href: "/student/profile", icon: User },
  { key: "rank", label: "Class Rank", short: "Rank", href: "/student/rank", icon: TrendingUp },
  { key: "attendance", label: "Attendance", href: "/student/attendance", icon: CalendarCheck },
  { key: "achievements", label: "Achievements", href: "/student/achievements", icon: Award },
  { key: "placement", label: "Placement", href: "/student/placement", icon: Briefcase },
  { key: "resume", label: "Resume Builder", href: "/student/resume", icon: FileText },
  { key: "documents", label: "Document Requests", href: "/student/documents", icon: FileText },
  { key: "notes", label: "Notes & Deadlines", href: "/student/notes", icon: BookOpen },
  { key: "counseling", label: "Counseling", href: "/student/counseling", icon: HeartHandshake },
  { key: "feedback", label: "Feedback", href: "/student/feedback", icon: MessageSquareQuote },
  { key: "assistant", label: "Ask Anviksha AI", href: "/student/assistant", icon: Bot },
];

const quickActions: QuickAction[] = [
  { label: "Add an achievement", href: "/student/achievements?action=add", keywords: "certificate hackathon project upload" },
  { label: "Request a document", href: "/student/documents?action=new", keywords: "bonafide transcript certificate" },
  { label: "Build my resume", href: "/student/resume", keywords: "cv download pdf" },
  { label: "Give feedback on my subjects", href: "/student/feedback", keywords: "rate teacher review anonymous" },
  { label: "Ask Anviksha AI", href: "/student/assistant", keywords: "chat assistant help" },
];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="student" roleLabel="Student" navItems={navItems} quickActions={quickActions}>
      {children}
    </AppShell>
  );
}
