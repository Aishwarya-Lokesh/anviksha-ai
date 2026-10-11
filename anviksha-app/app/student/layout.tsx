"use client";

import { useEffect, useState } from "react";
import { NavItem } from "@/components/layout/Sidebar";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";
import {
  LayoutDashboard, User, TrendingUp, CalendarCheck, Award, FileText,
  BookOpen, HeartHandshake, Bot, Briefcase,
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
  { key: "assistant", label: "Ask Anviksha AI", href: "/student/assistant", icon: Bot },
];

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState("Student");
  const [meta, setMeta] = useState("Student");

  useEffect(() => {
    api.studentDashboard().then((d) => { setName(d.name); setMeta(d.usn || "Student"); }).catch(() => {});
  }, []);

  return (
    <AppShell role="student" roleLabel="Student" navItems={navItems} userName={name} userMeta={meta}>
      {children}
    </AppShell>
  );
}
