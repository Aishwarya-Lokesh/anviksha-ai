"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { TrendLineChart, DonutChart } from "@/components/charts/Charts";
import { AskAIBar } from "@/components/ui/AskAI";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { GraduationCap, Users, BookOpen, FileStack, Activity, UserPlus, UserCog2, BookPlus, Upload, ClipboardList, FileBarChart, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import adminDataMock from "@/data/adminData.json";

export default function AdminDashboard() {
  const { push } = useToast();
  const router = useRouter();
  const [stats, setStats] = useState<any>(adminDataMock.stats);
  const [liveMode, setLiveMode] = useState(false);
  const [recentRequests, setRecentRequests] = useState<any[]>(adminDataMock.recentRequests);
  const { overviewTrend, departmentDistribution } = adminDataMock;

  useEffect(() => {
    api.adminStats()
      .then((s) => {
        setStats({
          totalStudents: s.total_students,
          totalFaculty: s.total_faculty,
          totalSubjects: s.total_subjects,
          documentRequests: s.pending_document_requests,
          activeUsers: s.active_students,
        });
        setLiveMode(true);
      })
      .catch(() => setLiveMode(false)); // backend not running — silently stays on mock data

    api.adminDocuments()
      .then((docs: any[]) => {
        const recent = docs
          .sort((a: any, b: any) => (b.requested_date || "").localeCompare(a.requested_date || ""))
          .slice(0, 6)
          .map((d: any) => ({ name: d.student_name || "Unknown Student", type: d.type, date: d.requested_date, status: d.status }));
        setRecentRequests(recent);
      })
      .catch(() => {}); // stays on mock data if backend unreachable
  }, []);

  const toneFor: Record<string, "warning" | "info" | "success" | "danger"> = {
    Pending: "warning", Collectable: "info", Collected: "success", Rejected: "danger",
  };

  const quickActions = [
    { label: "Add New Student", icon: UserPlus, href: "/admin/users?action=add-student" },
    { label: "Add New Faculty", icon: UserCog2, href: "/admin/users?action=add-faculty" },
    { label: "Add New Subject", icon: BookPlus, href: "/admin/datasets/subjects" },
    { label: "Upload Document", icon: Upload, href: "/admin/documents" },
    { label: "View Requests", icon: ClipboardList, href: "/admin/documents" },
    { label: "Generate Report", icon: FileBarChart, href: "/admin/reports" },
  ];

  return (
    <>
      <Topbar greeting="Welcome back, Admin! 👋" subtitle="Here's what's happening in your institute today." avatarLetter="A" />
      <div className="px-4 md:px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Live data from backend" : "○ Mock data (backend not connected)"}
        </span>
      </div>
      <div className="p-4 md:p-8 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Total Students" value={stats.totalStudents} icon={GraduationCap} tone="brand" delay={0} />
          <StatCard label="Total Faculty" value={stats.totalFaculty} icon={Users} tone="info" delay={0.05} />
          <StatCard label="Total Subjects" value={stats.totalSubjects} icon={BookOpen} tone="success" delay={0.1} />
          <StatCard label="Document Requests" value={stats.documentRequests} icon={FileStack} tone="warning" delay={0.15} />
          <StatCard label="Active Users" value={stats.activeUsers} icon={Activity} tone="danger" delay={0.2} />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2" hover>
            <SectionTitle title="Dashboard Overview" subtitle="This month" />
            <TrendLineChart
              data={overviewTrend}
              lines={[{ key: "students", color: "#5B3FD9" }, { key: "faculty", color: "#3B82F6" }, { key: "requests", color: "#E8A93B" }]}
            />
          </Card>
          <Card hover>
            <SectionTitle title="Students by Department" />
            <DonutChart data={departmentDistribution} centerValue={stats.totalStudents} centerLabel="Total" />
          </Card>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2" hover>
            <SectionTitle title="Recent Document Requests" />
            <div className="space-y-1">
              {recentRequests.map((r, i) => (
                <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                  <div>
                    <div className="text-sm font-medium text-ink">{r.name}</div>
                    <div className="text-xs text-muted">{r.type} · {r.date}</div>
                  </div>
                  <Badge tone={toneFor[r.status]}>{r.status}</Badge>
                </motion.div>
              ))}
            </div>
          </Card>
          <Card hover>
            <SectionTitle title="Quick Actions" />
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((q) => (
                <button key={q.label} onClick={() => router.push(q.href)} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 hover:bg-brand-light transition-colors group">
                  <q.icon size={18} className="text-muted group-hover:text-brand transition-colors" />
                  <span className="text-xs font-medium text-ink text-center">{q.label}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <div className="bg-navy rounded-2xl p-5 flex items-center gap-4 text-white">
          <ShieldCheck size={24} className="text-success shrink-0" />
          <div>
            <div className="text-sm font-semibold">System Status: All Systems Operational</div>
            <div className="text-xs text-white/50">Last updated just now</div>
          </div>
        </div>

        <AskAIBar onAsk={(q) => { push(`Opening AI Assistant for: "${q.slice(0, 40)}"`, "info"); router.push(`/admin/assistant?q=${encodeURIComponent(q)}`); }} />
      </div>
    </>
  );
}
