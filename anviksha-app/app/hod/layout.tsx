"use client";

import { useState, useEffect } from "react";
import { Sidebar, NavItem } from "@/components/layout/Sidebar";
import { AuthGuard } from "@/components/ui/AuthGuard";
import { api } from "@/lib/api";
import { LayoutDashboard, GraduationCap, Users, Briefcase, Bot, ClipboardCheck } from "lucide-react";

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", href: "/hod", icon: LayoutDashboard },
  { key: "students", label: "Department Students", href: "/hod/students", icon: GraduationCap },
  { key: "faculty", label: "Faculty Workload", href: "/hod/faculty", icon: Users },
  { key: "faculty-monitoring", label: "Faculty Monitoring", href: "/hod/faculty-monitoring", icon: ClipboardCheck },
  { key: "placements", label: "Placement Analytics", href: "/hod/placements", icon: Briefcase },
  { key: "assistant", label: "Ask Anviksha AI", href: "/hod/assistant", icon: Bot },
];

export default function HodLayout({ children }: { children: React.ReactNode }) {
  const [meta, setMeta] = useState("Head of Department");

  useEffect(() => {
    api.hodMe().then((d) => setMeta(d.department || "Head of Department")).catch(() => {});
  }, []);

  return (
    <AuthGuard requiredRole="hod">
      <div className="flex bg-surface min-h-screen">
        <Sidebar navItems={navItems} userName="HOD" userMeta={meta} roleLabel="HOD" />
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </AuthGuard>
  );
}
