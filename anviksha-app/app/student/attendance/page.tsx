"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { motion } from "framer-motion";
import { Inbox } from "lucide-react";
import { api } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

function statusFor(pct: number) {
  if (pct >= 90) return { label: "Excellent", tone: "success" as const };
  if (pct >= 75) return { label: "Good", tone: "info" as const };
  if (pct >= 60) return { label: "Average", tone: "warning" as const };
  return { label: "Low", tone: "danger" as const };
}

export default function AttendancePage() {
  const [data, setData] = useState<any>(null);
  const [liveMode, setLiveMode] = useState(false);

  useEffect(() => {
    api.myAttendance().then((d) => { setData(d); setLiveMode(true); }).catch(() => setData({ subjects: [], overall_pct: null, total_sessions_recorded: 0 }));
  }, []);

  if (!data) return <><Topbar greeting="My Attendance" subtitle="Loading..." avatarLetter="S" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="My Attendance" subtitle="Dashboard > Attendance" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-6">
        {data.subjects.length === 0 ? (
          <Card className="text-center py-12" hover>
            <Inbox size={32} className="text-muted mx-auto mb-3 opacity-50" />
            <p className="text-sm font-medium text-ink mb-1">No attendance sessions recorded yet</p>
            <p className="text-xs text-muted">This isn't an error — it means none of your teachers have marked a session for you yet via Attendance Upload. As soon as they do, numbers will appear here.</p>
          </Card>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {data.subjects.map((r: any, i: number) => {
                const st = statusFor(r.pct);
                return (
                  <motion.div key={r.code} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                    <Card className="text-center" hover>
                      <div className="text-2xl font-extrabold font-display text-ink numeric">{r.pct}%</div>
                      <div className="text-xs text-muted mt-1">{r.code}</div>
                      <Badge tone={st.tone} className="mt-2">{st.label}</Badge>
                    </Card>
                  </motion.div>
                );
              })}
            </div>

            <Card hover>
              <SectionTitle title="Subject-wise Attendance" subtitle={`Overall: ${data.overall_pct}% across ${data.total_sessions_recorded} recorded sessions`} />
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-muted border-b border-gray-100">
                      <th className="py-2.5 font-medium">Subject Code</th>
                      <th className="py-2.5 font-medium">Subject Name</th>
                      <th className="py-2.5 font-medium">Classes Held</th>
                      <th className="py-2.5 font-medium">Classes Attended</th>
                      <th className="py-2.5 font-medium">Attendance %</th>
                      <th className="py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.subjects.map((r: any) => {
                      const st = statusFor(r.pct);
                      return (
                        <tr key={r.code} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                          <td className="py-3 font-medium text-ink">{r.code}</td>
                          <td className="py-3 text-ink">{r.name}</td>
                          <td className="py-3 text-muted">{r.held}</td>
                          <td className="py-3 text-muted">{r.attended}</td>
                          <td className="py-3 font-semibold text-ink numeric">{r.pct}%</td>
                          <td className="py-3"><Badge tone={st.tone}>{st.label}</Badge></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
