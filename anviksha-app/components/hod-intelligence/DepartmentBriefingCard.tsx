"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { hodIntelligenceApi } from "@/lib/hodIntelligenceApi";
import { Sparkles, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Phase 6 (stretch) — AI Department Briefing. Additive card on the existing
 * HOD dashboard (does not replace the existing AIInsightCard, which is a
 * different, simpler, already-existing insight — Part A1 says don't touch
 * existing pieces). Every number in this briefing is validated server-side
 * against the real facts it was grounded in (app.core.hod_metrics); the
 * "Data used" affordance below exposes exactly those facts, per the spec's
 * "expandable Data used" requirement.
 */
export function DepartmentBriefingCard() {
  const [data, setData] = useState<any>(null);
  const [showFacts, setShowFacts] = useState(false);

  useEffect(() => {
    hodIntelligenceApi.briefing().then(setData).catch(() => setData(null));
  }, []);

  if (!data || !data.briefing) return null;

  return (
    <Card hover>
      <div className="flex items-center justify-between mb-1">
        <SectionTitle title="Department Briefing" subtitle="Grounded only in the real facts below — no invented numbers or names" />
        <Badge tone={data.source === "ai" ? "brand" : "neutral"}>{data.source === "ai" ? "AI-generated" : "Deterministic"}</Badge>
      </div>
      <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }} className="text-sm text-ink leading-relaxed flex gap-2">
        <Sparkles size={15} className="text-brand shrink-0 mt-0.5" />
        <span>{data.briefing}</span>
      </motion.p>

      <button onClick={() => setShowFacts((v) => !v)} className="flex items-center gap-1 text-xs text-brand font-medium mt-3 hover:underline">
        Data used {showFacts ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
      </button>
      {showFacts && data.facts_used && (
        <div className="mt-2 p-3 rounded-xl bg-gray-50 space-y-1">
          {Object.entries(data.facts_used).map(([key, value]: [string, any]) => (
            <div key={key} className="text-[11px] text-muted">
              <span className="font-semibold text-ink">{key.replace(/_/g, " ")}:</span> {String(value)}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
