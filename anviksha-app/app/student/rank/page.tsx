"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { motion } from "framer-motion";
import { Trophy } from "lucide-react";
import { api } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { Celebration } from "@/components/ui/Celebration";

const TOP_RANK_THRESHOLD = 20;

export default function RankPage() {
  const [rankData, setRankData] = useState<any>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    api.studentRank()
      .then((r) => {
        setRankData(r);
        setLiveMode(true);
        if (r.rank != null && r.rank <= TOP_RANK_THRESHOLD) setCelebrate(true);
      })
      .catch(() => setLiveMode(false));
  }, []);

  if (rankData === null && liveMode === false) {
    // still waiting on the very first response
  }

  if (!rankData) return <><Topbar greeting="Class Rank & Comparison" subtitle="Loading your real rank..." avatarLetter="S" /><DashboardSkeleton /></>;

  const percentile = rankData.rank && rankData.cohort_size ? Math.round((rankData.rank / rankData.cohort_size) * 100) : null;

  return (
    <>
      <Celebration
        active={celebrate}
        onDone={() => setCelebrate(false)}
        durationMs={10000}
        message={`🏆 Rank #${rankData.rank} in your batch — top ${TOP_RANK_THRESHOLD}!`}
      />
      <Topbar greeting="Class Rank & Comparison" subtitle="See where you stand in your batch" avatarLetter="S" />
      <div className="px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Live — real rank among your real batchmates" : "○ Backend not connected"}
        </span>
      </div>
      <div className="p-8 space-y-6">
        {rankData.note && (
          <div className="text-xs bg-warning/10 text-[#9c6b12] rounded-xl p-3">{rankData.note}</div>
        )}
        <Card className="text-center flex flex-col items-center justify-center py-8" hover>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 200 }} className="w-20 h-20 rounded-full bg-brand-light flex items-center justify-center mb-4">
            <Trophy size={36} className="text-brand" />
          </motion.div>
          <div className="text-4xl font-extrabold font-display text-ink">#{rankData.rank ?? "N/A"}</div>
          <div className="text-sm text-muted mt-1">out of {rankData.cohort_size} students with complete CGPA data</div>
          {percentile != null && <Badge tone="success" className="mt-3">Top {percentile}%</Badge>}
        </Card>

        <Card hover>
          <SectionTitle title="Top Performers in Your Batch" subtitle="Real students, real CGPA — same cohort as you" />
          <div className="space-y-1">
            {rankData.top_performers.map((s: any, i: number) => (
              <motion.div
                key={s.usn}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex items-center justify-between p-3 rounded-xl ${s.is_you ? "bg-brand-light" : "hover:bg-gray-50"} transition-colors`}
              >
                <div className="flex items-center gap-3">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${i < 3 ? "bg-warning/20 text-[#9c6b12]" : "bg-gray-100 text-muted"}`}>{i + 1}</div>
                  <div>
                    <div className="text-sm font-medium text-ink">{s.name}{s.is_you && " (You)"}</div>
                    <div className="text-xs text-muted">{s.usn}</div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-ink numeric">{s.cgpa?.toFixed(2)}</div>
              </motion.div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
