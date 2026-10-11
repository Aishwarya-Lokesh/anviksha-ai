"use client";

import { NavItem } from "@/components/layout/Sidebar";
import { AppShell } from "@/components/layout/AppShell";
import type { QuickAction } from "@/components/layout/CommandPalette";
import {
  LayoutDashboard, Users, CalendarCheck, FileQuestion, Presentation,
  BarChart3, HeartHandshake, ClipboardList, Bot, ClipboardCheck, NotebookPen, UserCircle
} from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/teacher", icon: LayoutDashboard },
  { key: "students", label: "My Students", short: "Students", href: "/teacher/students", icon: Users },
  { key: "attendance", label: "Attendance Upload", short: "Attendance", href: "/teacher/attendance", icon: CalendarCheck },
  { key: "notes", label: "Notes & Deadlines", short: "Notes", href: "/teacher/notes", icon: NotebookPen },
  { key: "qpaper", label: "Question Paper Generator", href: "/teacher/question-paper", icon: FileQuestion },
  { key: "iamarks", label: "IA Marks", href: "/teacher/ia-marks", icon: ClipboardCheck },
  { key: "ppt", label: "AI PPT Generator", href: "/teacher/ppt-generator", icon: Presentation },
  { key: "performance", label: "Performance & Feedback", href: "/teacher/performance", icon: BarChart3 },
  { key: "counseling", label: "Student Counseling", href: "/teacher/counseling", icon: HeartHandshake },
  { key: "reports", label: "Reports", href: "/teacher/reports", icon: ClipboardList },
  { key: "assistant", label: "Ask Anviksha AI", href: "/teacher/assistant", icon: Bot },
  { key: "profile", label: "My Profile", href: "/teacher/profile", icon: UserCircle },
];

const quickActions: QuickAction[] = [
  { label: "Generate a PPT", href: "/teacher/ppt-generator", keywords: "slides presentation powerpoint" },
  { label: "Create a question paper", href: "/teacher/question-paper", keywords: "exam IA test" },
  { label: "Mark attendance", href: "/teacher/attendance", keywords: "present absent" },
  { label: "Post a note or deadline", href: "/teacher/notes", keywords: "assignment study material" },
  { label: "Enter IA marks", href: "/teacher/ia-marks", keywords: "internal assessment scores" },
];

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell role="teacher" roleLabel="Teacher" navItems={navItems} quickActions={quickActions}>
      {children}
    </AppShell>
  );
}
