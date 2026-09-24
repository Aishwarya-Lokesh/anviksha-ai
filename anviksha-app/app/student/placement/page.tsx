"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { motion } from "framer-motion";
import { Briefcase, ExternalLink, Inbox, Building2, IndianRupee } from "lucide-react";
import { api } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

export default function PlacementPage() {
  const [placement, setPlacement] = useState<any>(null);
  const [internships, setInternships] = useState<any[]>([]);
  const [liveMode, setLiveMode] = useState(false);

  useEffect(() => {
    api.myPlacement().then((p) => { setPlacement(p); setLiveMode(true); }).catch(() => setLiveMode(false));
    api.myInternships().then(setInternships).catch(() => {});
  }, []);

  if (!placement) return <><Topbar greeting="Placement" subtitle="Loading your real placement record..." avatarLetter="S" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting="Placement" subtitle="Dashboard > Placement" avatarLetter="S" />
      <div className="px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Live data from backend" : "○ Mock data (backend not connected)"}
        </span>
      </div>
      <div className="p-8 space-y-6">
        <Card hover>
          <SectionTitle title="Placement Status" />
          {!placement.available ? (
            <div className="text-center py-10">
              <Inbox size={28} className="text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted">{placement.note}</p>
            </div>
          ) : (
            <div className="flex items-start gap-4">
              <div className="w-14 h-14 rounded-2xl bg-brand-light flex items-center justify-center shrink-0">
                <Briefcase size={26} className="text-brand" />
              </div>
              <div className="flex-1 space-y-3">
                <div className="flex items-center gap-2">
                  <Badge tone={placement.placed ? "success" : "warning"}>{placement.placed ? "Placed" : "Not Yet Placed"}</Badge>
                  {placement.placement_type && <Badge tone="brand">{placement.placement_type} Drive</Badge>}
                </div>

                {placement.company && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50">
                      <Building2 size={16} className="text-brand shrink-0" />
                      <div>
                        <div className="text-[10px] text-muted uppercase tracking-wide">Company</div>
                        <div className="text-sm font-semibold text-ink">{placement.company}</div>
                      </div>
                    </div>
                    {placement.ctc && (
                      <div className="flex items-center gap-2 p-3 rounded-xl bg-gray-50">
                        <IndianRupee size={16} className="text-brand shrink-0" />
                        <div>
                          <div className="text-[10px] text-muted uppercase tracking-wide">Package (CTC)</div>
                          <div className="text-sm font-semibold text-ink">{placement.ctc}</div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {placement.placed && !placement.company && (
                  <p className="text-xs text-muted italic">Company and package details aren't in the current dataset for your record — status only.</p>
                )}

                {placement.resume_link && (
                  <a href={placement.resume_link} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline flex items-center gap-1">
                    <ExternalLink size={12} /> View submitted resume
                  </a>
                )}
              </div>
            </div>
          )}
        </Card>

        {internships.length > 0 && (
          <Card hover>
            <SectionTitle title="Internships" subtitle="Real internship record on file" />
            <div className="grid md:grid-cols-2 gap-4">
              {internships.map((i: any, idx: number) => (
                <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.05 }} className="flex gap-3 p-4 rounded-xl bg-gray-50">
                  <Briefcase size={18} className="text-brand mt-0.5 shrink-0" />
                  <div>
                    <div className="text-sm font-bold text-ink">{i.company}</div>
                    <div className="text-xs text-muted mt-0.5">{i.duration}</div>
                    <Badge tone={i.stipend === "Not Available" ? "neutral" : "success"} className="mt-1.5">Stipend: {i.stipend}</Badge>
                  </div>
                </motion.div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
