"use client";

import { useState, useEffect } from "react";
import { Sidebar, NavItem } from "@/components/layout/Sidebar";
import { AuthGuard } from "@/components/ui/AuthGuard";
import { api } from "@/lib/api";
import {
  LayoutDashboard, Users, CalendarCheck, FileQuestion, Presentation,
  BarChart3, HeartHandshake, ClipboardList, Bot, ClipboardCheck, NotebookPen,
} from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/teacher", icon: LayoutDashboard },
  { key: "students", label: "My Students", href: "/teacher/students", icon: Users },
  { key: "attendance", label: "Attendance Upload", href: "/teacher/attendance", icon: CalendarCheck },
  { key: "notes", label: "Notes & Deadlines", href: "/teacher/notes", icon: NotebookPen },
  { key: "qpaper", label: "Question Paper Generator", href: "/teacher/question-paper", icon: FileQuestion },
  { key: "iamarks", label: "IA Marks", href: "/teacher/ia-marks", icon: ClipboardCheck },
  { key: "ppt", label: "AI PPT Generator", href: "/teacher/ppt-generator", icon: Presentation },
  { key: "performance", label: "Performance & Feedback", href: "/teacher/performance", icon: BarChart3 },
  { key: "counseling", label: "Student Counseling", href: "/teacher/counseling", icon: HeartHandshake },
  { key: "reports", label: "Reports", href: "/teacher/reports", icon: ClipboardList },
  { key: "assistant", label: "Ask Anviksha AI", href: "/teacher/assistant", icon: Bot },
];

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState("Teacher");
  const [meta, setMeta] = useState("Logged in");

  useEffect(() => {
    api.teacherMe().then((d) => { setName(d.name); setMeta(d.designation || "Faculty"); }).catch(() => {});
  }, []);

  return (
    <AuthGuard requiredRole="teacher">
      <div className="flex bg-surface min-h-screen">
        <Sidebar navItems={navItems} userName={name} userMeta={meta} roleLabel="Teacher" />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </AuthGuard>
  );
}
