"use client";

import { NavItem } from "@/components/layout/Sidebar";
import { AppShell } from "@/components/layout/AppShell";
import type { QuickAction } from "@/components/layout/CommandPalette";
import { LayoutDashboard, GraduationCap, Users, Briefcase, Bot, ClipboardCheck, BarChart3, UserCircle, MessageSquareQuote, Megaphone, FilePenLine, FileStack } from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/hod", icon: LayoutDashboard },
  { key: "students", label: "Department Students", short: "Students", href: "/hod/students", icon: GraduationCap },
  { key: "faculty", label: "Faculty Workload", short: "Faculty", href: "/hod/faculty", icon: Users },
  { key: "faculty-monitoring", label: "Faculty Monitoring", short: "Monitoring", href: "/hod/faculty-monitoring", icon: ClipboardCheck },
  { key: "feedback", label: "Faculty Feedback", href: "/hod/feedback", icon: MessageSquareQuote },
  { key: "assessment-analytics", label: "Assessment Analytics", href: "/hod/assessment-analytics", icon: BarChart3 },
  { key: "placements", label: "Placement Analytics", href: "/hod/placements", icon: Briefcase },
  { key: "placement-records", label: "Placement Records", href: "/hod/placement-records", icon: FilePenLine },
  { key: "project-formats", label: "Project Formats", href: "/hod/project-formats", icon: FileStack },
  { key: "announcements", label: "Announcements", href: "/hod/announcements", icon: Megaphone },
  { key: "assistant", label: "Ask Anviksha AI", href: "/hod/assistant", icon: Bot },
  { key: "profile", label: "My Profile", href: "/hod/profile", icon: UserCircle },
];

const quickActions: QuickAction[] = [
  { label: "Compare placement across batches", href: "/hod/placements", keywords: "placed package companies" },
  { label: "Review faculty workload", href: "/hod/faculty", keywords: "subjects extra work" },
  { label: "See student feedback on faculty", href: "/hod/feedback", keywords: "ratings review teachers" },
  { label: "Upload the official project report or PPT format", href: "/hod/project-formats", keywords: "template docx pptx format students" },
  { label: "Post an announcement", href: "/hod/announcements", keywords: "notice department message" },
  { label: "Add or correct a placement record", href: "/hod/placement-records", keywords: "offer internship edit" },
  { label: "Check today's attendance", href: "/hod", keywords: "live classes" },
  { label: "Ask Anviksha AI", href: "/hod/assistant", keywords: "chat assistant department" },
];

export default function HodLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="hod" roleLabel="HOD" navItems={navItems} quickActions={quickActions}>
      {children}
    </AppShell>
  );
}
