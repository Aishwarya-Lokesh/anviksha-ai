"use client";

import { useState, useEffect } from "react";
import { NavItem } from "@/components/layout/Sidebar";
import { AppShell } from "@/components/layout/AppShell";
import { api } from "@/lib/api";
import { LayoutDashboard, GraduationCap, Users, Briefcase, Bot, ClipboardCheck, BarChart3 } from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/hod", icon: LayoutDashboard },
  { key: "students", label: "Department Students", short: "Students", href: "/hod/students", icon: GraduationCap },
  { key: "faculty", label: "Faculty Workload", short: "Faculty", href: "/hod/faculty", icon: Users },
  { key: "faculty-monitoring", label: "Faculty Monitoring", short: "Monitoring", href: "/hod/faculty-monitoring", icon: ClipboardCheck },
  { key: "assessment-analytics", label: "Assessment Analytics", href: "/hod/assessment-analytics", icon: BarChart3 },
  { key: "placements", label: "Placement Analytics", href: "/hod/placements", icon: Briefcase },
  { key: "assistant", label: "Ask Anviksha AI", href: "/hod/assistant", icon: Bot },
];

export default function HodLayout({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState("Head of Department");
  const [meta, setMeta] = useState("Department");

  useEffect(() => {
    api.hodMe().then((d) => { setName(d.title || "Head of Department"); setMeta(d.department || "Department"); }).catch(() => {});
  }, []);

  return (
    <AppShell role="hod" roleLabel="HOD" navItems={navItems} userName={name} userMeta={meta}>
      {children}
    </AppShell>
  );
}
