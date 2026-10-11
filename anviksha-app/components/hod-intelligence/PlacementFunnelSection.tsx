"use client";

import { useEffect, useState } from "react";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { MetricExplain } from "@/components/ui/MetricExplain";
import { DonutChart } from "@/components/charts/Charts";
import { HorizontalBarChart } from "@/components/charts/hod-intelligence/HorizontalBarChart";
import { hodIntelligenceApi } from "@/lib/hodIntelligenceApi";

/**
 * Phase 5 — Placement Funnel. Additive section on the existing
 * /hod/placements page (a page for this exact domain already existed, so a
 * whole new page/nav item would only fragment one concept in two places —
 * same precedent as Phases 1/3 extending the existing HOD dashboard).
 *
 * A real 2-stage funnel only (Tracked -> Placed): the Placement schema has
 * no Applied/Shortlisted/Interviewed stage anywhere (Phase 0, section H) —
 * a richer funnel would mean inventing stages the data doesn't have.
 */
export function PlacementFunnelSection() {
  const [funnel, setFunnel] = useState<any>(null);
  const [tiers, setTiers] = useState<any>(null);
  const [cycles, setCycles] = useState<any>(null);

  useEffect(() => {
    hodIntelligenceApi.placementFunnel().then(setFunnel).catch(() => setFunnel({ status: "unavailable" }));
    hodIntelligenceApi.placementTiers().then(setTiers).catch(() => setTiers({ status: "unavailable" }));
    hodIntelligenceApi.placementCycleComparison().then(setCycles).catch(() => setCycles({ status: "unavailable" }));
  }, []);

  if (!funnel || !tiers || !cycles) return null;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      <Card hover>
        <div className="flex items-center justify-between mb-1">
          <SectionTitle title="Placement Funnel" subtitle="Students tracked, then placed" />
        </div>
        {funnel.status !== "available" ? (
          <p className="text-sm text-muted text-center py-10">{funnel.reason_unavailable}</p>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-2">
              <MetricExplain explanation={funnel.explanation} />
            </div>
            <HorizontalBarChart
              data={funnel.stages.map((s: any) => ({ label: s.stage, value: s.pct_of_first, severity: s.stage === "Placed" ? (s.pct_of_first >= 75 ? "green" : s.pct_of_first >= 50 ? "amber" : "red") : "neutral" }))}
            />
            <div className="flex justify-center gap-4 mt-2">
              {funnel.stages.map((s: any) => (
                <div key={s.stage} className="text-center">
                  <div className="text-lg font-bold text-ink numeric">{s.count}</div>
                  <div className="text-[11px] text-muted">{s.stage}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </Card>

      <Card hover>
        <SectionTitle title="Offer Tiers" subtitle="CTC-based classification of placed students" />
        {tiers.status !== "available" ? (
          <p className="text-sm text-muted text-center py-10">{tiers.reason_unavailable}</p>
        ) : (
          <>
            <DonutChart
              data={[
                { name: "Regular (<6 LPA)", value: tiers.tiers.regular, color: "#6B7280" },
                { name: "Dream (6-10 LPA)", value: tiers.tiers.dream, color: "#5B3FD9" },
                { name: "Super Dream (>10 LPA)", value: tiers.tiers.super_dream, color: "#1F9D55" },
              ]}
              centerValue={tiers.tiers.classifiable_count} centerLabel="Classified"
            />
            <p className="text-[11px] text-muted text-center mt-1">{tiers.tiers.note}</p>
          </>
        )}
      </Card>

      <Card hover className="lg:col-span-2">
        <SectionTitle title="Cycle Comparison" subtitle="Passed-out cohorts (graduation years), compared against each other" />
        {cycles.status !== "available" ? (
          <p className="text-sm text-muted text-center py-8">{cycles.reason_unavailable}</p>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-3">
            {cycles.cycles.map((c: any) => (
              <div key={c.passed_out_year} className="p-3.5 rounded-xl border border-gray-100">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold text-ink">{c.passed_out_year}</span>
                  <Badge tone={c.placement_pct >= 75 ? "success" : c.placement_pct >= 50 ? "warning" : "danger"}>{c.placement_pct}%</Badge>
                </div>
                <div className="text-xs text-muted">{c.placed} / {c.total} placed</div>
                <div className="text-xs text-muted">{c.avg_ctc_lpa !== null ? `${c.avg_ctc_lpa} LPA avg` : "CTC not available"}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
