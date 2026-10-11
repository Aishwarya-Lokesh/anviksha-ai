"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { FileText, Download, Clock, Inbox } from "lucide-react";
import { api, API_BASE } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

function daysLeft(dateStr: string) {
  const diff = Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  return diff;
}

export default function NotesPage() {
  const [data, setData] = useState<{ notes: any[]; deadlines: any[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { push } = useToast();

  useEffect(() => {
    api.studentNotes().then(setData).catch(() => setLoadError(true));
  }, []);

  if (!data && !loadError) {
    return <><Topbar greeting="Notes & Deadlines" subtitle="Loading..." avatarLetter="S" /><DashboardSkeleton /></>;
  }
  if (loadError) {
    return <><Topbar greeting="Notes & Deadlines" subtitle="Unable to load. Please try again." avatarLetter="S" /><div className="p-4 md:p-8 text-sm text-danger">Unable to load notes and deadlines. Please try again.</div></>;
  }

  const { notes, deadlines } = data!;
  const sortedDeadlines = [...deadlines].sort((a, b) => (a.due_date < b.due_date ? -1 : 1));

  return (
    <>
      <Topbar greeting="Notes & Deadlines" subtitle="Dashboard > Notes & Deadlines" avatarLetter="S" />
      <div className="p-4 md:p-8 grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2" hover>
          <SectionTitle title="Subject Notes" subtitle="Uploaded by your teachers, for your batch/semester/section only" />
          {notes.length === 0 ? (
            <div className="text-center py-10">
              <Inbox size={26} className="text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted">No notes have been uploaded by your teachers yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notes.map((n, i) => (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 hover:border-brand/40 hover:bg-brand-light/40 transition-colors group"
                >
                  <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center shrink-0">
                    <FileText size={18} className="text-brand" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{n.title}</div>
                    <div className="text-xs text-muted truncate">{[n.subject, n.teacher_name, n.created_at?.slice(0, 10)].filter(Boolean).join(" · ")}</div>
                    {n.description && <div className="text-xs text-muted mt-0.5 line-clamp-1">{n.description}</div>}
                  </div>
                  {n.file_url ? (
                    <a href={`${API_BASE}${n.file_url}`} target="_blank" rel="noreferrer" className="opacity-0 group-hover:opacity-100 transition-opacity text-brand p-2 rounded-lg hover:bg-white shrink-0">
                      <Download size={16} />
                    </a>
                  ) : (
                    <span className="text-[10px] text-muted shrink-0">No file</span>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </Card>

        <Card hover>
          <SectionTitle title="Upcoming Deadlines" />
          {sortedDeadlines.length === 0 ? (
            <div className="text-center py-10">
              <Inbox size={22} className="text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted">None</p>
            </div>
          ) : (
            <div className="space-y-4 relative pl-4 border-l-2 border-dashed border-gray-200">
              {sortedDeadlines.map((e, i) => {
                const d = daysLeft(e.due_date);
                return (
                  <motion.div key={e.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.1 }} className="relative">
                    <div className="absolute -left-[21px] top-1 w-3 h-3 rounded-full bg-brand border-2 border-white" />
                    <div className="text-sm font-medium text-ink">{e.title}</div>
                    <div className="text-xs text-muted mb-1">{e.subject ? `${e.subject} · ` : ""}{e.due_date}</div>
                    <Badge tone={d < 0 ? "danger" : d < 7 ? "danger" : d < 21 ? "warning" : "brand"}>
                      <Clock size={11} className="mr-1" /> {d < 0 ? "Past due" : d === 0 ? "Today" : `${d} days left`}
                    </Badge>
                  </motion.div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
