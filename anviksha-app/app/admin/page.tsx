"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { DonutChart, SimpleBarChart } from "@/components/charts/Charts";
import { AskAIBar } from "@/components/ui/AskAI";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { GraduationCap, Users, BookOpen, FileStack, Activity, UserPlus, UserCog2, BookPlus, Upload, ClipboardList, FileBarChart, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { LoadError, EmptyState } from "@/components/ui/States";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

export default function AdminDashboard() {
  const { push } = useToast();
  const router = useRouter();
  const [stats, setStats] = useState<any>(null);
  const [loadError, setLoadError] = useState(false);
  const [recentRequests, setRecentRequests] = useState<any[] | null>(null);
  const [batches, setBatches] = useState<{ label: string; value: number }[] | null>(null);

  const load = () => {
    setLoadError(false);
    api.adminStats()
      .then((s) => {
        setStats({
          totalStudents: s.total_students,
          totalFaculty: s.total_faculty,
          totalSubjects: s.total_subjects,
          documentRequests: s.pending_document_requests,
          activeUsers: s.active_students,
          passedOut: s.passed_out_students,
        });
      })
      .catch(() => setLoadError(true));

    api.adminBatches()
      .then((b: Record<string, { active: number; passed_out: number; unknown: number }>) =>
        setBatches(Object.keys(b).sort().map((k) => ({ label: k, value: b[k].active + b[k].passed_out + b[k].unknown }))))
      .catch(() => setBatches([]));

    api.adminDocuments()
      .then((docs: any[]) => {
        const recent = docs
          .sort((a: any, b: any) => (b.requested_date || "").localeCompare(a.requested_date || ""))
          .slice(0, 6)
          .map((d: any) => ({ name: d.student_name || "Unknown Student", type: d.type, date: d.requested_date, status: d.status }));
        setRecentRequests(recent);
      })
      .catch(() => setRecentRequests([]));
  };
  useEffect(load, []);

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

  if (loadError) return <><Topbar greeting="Admin Dashboard" subtitle="Institute overview" avatarLetter="A" /><LoadError message="We couldn't load the dashboard." onRetry={load} /></>;
  if (!stats) return <><Topbar greeting="Admin Dashboard" subtitle="Loading…" avatarLetter="A" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="Welcome back, Admin! 👋" subtitle="Here's what's happening in your institute today." avatarLetter="A" />
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
            <SectionTitle title="Students by Batch" subtitle="Entry year, all statuses" />
            {batches === null ? (
              <p className="text-sm text-muted text-center py-16">Loading…</p>
            ) : batches.length === 0 ? (
              <EmptyState title="No students on record yet" compact />
            ) : (
              <SimpleBarChart data={batches} xKey="label" barKey="value" yLabel="Students" showValues />
            )}
          </Card>
          <Card hover>
            <SectionTitle title="Student Status" />
            <DonutChart
              data={[
                { name: "Active", value: stats.activeUsers, color: "#1F9D55" },
                { name: "Passed out", value: stats.passedOut, color: "#6B7280" },
              ]}
              centerValue={stats.totalStudents}
              centerLabel="Total"
            />
          </Card>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2" hover>
            <SectionTitle title="Recent Document Requests" />
            <div className="space-y-1">
              {recentRequests === null && <p className="text-sm text-muted text-center py-8">Loading…</p>}
              {recentRequests !== null && recentRequests.length === 0 && <EmptyState title="No document requests yet" compact />}
              {(recentRequests || []).map((r, i) => (
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

        <AskAIBar onAsk={(q) => { push(`Opening AI Assistant for: "${q.slice(0, 40)}"`, "info"); router.push(`/admin/assistant?q=${encodeURIComponent(q)}`); }} />
      </div>
    </>
  );
}
