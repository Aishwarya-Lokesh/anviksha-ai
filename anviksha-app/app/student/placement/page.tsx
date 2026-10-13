"use client";

import { useEffect, useState } from "react";
import { BadgeCheck, Briefcase, Building2, ExternalLink, GraduationCap, IndianRupee } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { api } from "@/lib/api";

type Offer = { id: number; company: string; role: string | null; package_lpa: number | null; ctc: string | null; offer_type: string | null; status: string | null; offer_date: string | null; drive_type: string | null; verified: boolean };
type Internship = { id: number; company: string; role: string | null; stipend_per_month: number | null; duration: string | null; start_date: string | null; end_date: string | null; status: string | null; mode: string | null; verified: boolean };

const OFFER_WORD: Record<string, string> = { "full-time": "Full-time offer", PPO: "Pre-placement offer (PPO)", "internship+PPO": "Internship + PPO" };
const STATUS_TONE: Record<string, "success" | "info" | "neutral" | "brand"> = { offered: "brand", accepted: "success", joined: "success", declined: "neutral", ongoing: "info", completed: "success" };
const nice = (d: string | null) => (d ? new Date(`${d}T00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);

export default function PlacementPage() {
  const [data, setData] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    api.myPlacement().then(setData).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const title = "Placements & Internships";
  if (failed) return <><Topbar greeting={title} subtitle="Your record" avatarLetter="S" /><LoadError message="We couldn't load your placement record." onRetry={load} /></>;
  if (!data) return <><Topbar greeting={title} subtitle="Loading your record…" avatarLetter="S" /><DashboardSkeleton /></>;

  const offers: Offer[] = data.placements || [];
  const internships: Internship[] = data.internships || [];
  const live = offers.filter((o) => o.status !== "declined");
  const best = live.reduce<Offer | null>((top, o) => ((o.package_lpa || 0) > (top?.package_lpa || 0) ? o : top), null);

  return (
    <>
      <Topbar greeting={title} subtitle="Dashboard > Placements & Internships" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="grid sm:grid-cols-3 gap-4">
          <Card>
            <div className="text-xs text-muted">Status</div>
            <div className="mt-2"><Badge tone={offers.length ? "success" : "neutral"}>{offers.length ? "Placed" : "No offer recorded yet"}</Badge></div>
            <div className="text-xs text-muted mt-2">{offers.length} offer{offers.length === 1 ? "" : "s"} · {internships.length} internship{internships.length === 1 ? "" : "s"}</div>
          </Card>
          <Card>
            <div className="text-xs text-muted">Highest package</div>
            <div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{best?.package_lpa != null ? `${best.package_lpa} LPA` : "—"}</div>
            <div className="text-xs text-muted mt-1 truncate">{best?.company || "Appears once an offer is recorded"}</div>
          </Card>
          <Card>
            <div className="text-xs text-muted">Internships</div>
            <div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{internships.length}</div>
            <div className="text-xs text-muted mt-1 truncate">{internships.map((i) => i.company).join(", ") || "None recorded yet"}</div>
          </Card>
        </div>

        <Card>
          <SectionTitle title="My offers" subtitle="Recorded by the placement cell. Tell your HOD if something is missing or wrong." />
          {offers.length === 0 ? (
            <EmptyState icon={Briefcase} title="No offers recorded yet" hint="When the placement cell records an offer for you, it appears here, on your profile and on your resume." />
          ) : (
            <ul className="grid md:grid-cols-2 gap-4">
              {offers.map((o) => (
                <li key={o.id} className={`rounded-2xl border p-4 ${o.status === "declined" ? "border-gray-100 opacity-70" : "border-gray-100"}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-brand-light flex items-center justify-center shrink-0"><Building2 size={20} className="text-brand" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-semibold text-ink break-words">{o.company}</div>
                      {o.role && <div className="text-sm text-muted">{o.role}</div>}
                    </div>
                    {o.package_lpa != null && (
                      <div className="text-right shrink-0">
                        <div className="text-lg font-extrabold font-display text-ink numeric inline-flex items-center"><IndianRupee size={15} />{o.package_lpa} LPA</div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {o.offer_type && <Badge tone="brand">{OFFER_WORD[o.offer_type] || o.offer_type}</Badge>}
                    {o.status && <Badge tone={STATUS_TONE[o.status] || "neutral"}>{o.status[0].toUpperCase() + o.status.slice(1)}</Badge>}
                    {o.drive_type && o.drive_type !== "Not specified" && <Badge tone="neutral">{o.drive_type} drive</Badge>}
                    {o.verified && <Badge tone="success"><BadgeCheck size={12} className="mr-1" /> Verified</Badge>}
                  </div>
                  {o.offer_date && <div className="text-xs text-muted mt-2">Offer date: {nice(o.offer_date)}</div>}
                </li>
              ))}
            </ul>
          )}
          {data.resume_link && (
            <a href={data.resume_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 min-h-[44px] text-sm text-brand hover:underline mt-3">
              <ExternalLink size={14} /> Resume submitted to the placement cell
            </a>
          )}
        </Card>

        <Card>
          <SectionTitle title="My internships" />
          {internships.length === 0 ? (
            <EmptyState icon={GraduationCap} title="No internships recorded yet" hint="Internships recorded by the department appear here. You can also add an internship certificate under Achievements." />
          ) : (
            <ul className="grid md:grid-cols-2 gap-4">
              {internships.map((i) => (
                <li key={i.id} className="rounded-2xl border border-gray-100 p-4">
                  <div className="flex items-start gap-3">
                    <div className="w-11 h-11 rounded-xl bg-success/10 flex items-center justify-center shrink-0"><GraduationCap size={20} className="text-success" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-base font-semibold text-ink break-words">{i.company}</div>
                      {i.role && <div className="text-sm text-muted">{i.role}</div>}
                    </div>
                    {i.stipend_per_month != null && <div className="text-sm font-bold text-ink numeric shrink-0">₹{Number(i.stipend_per_month).toLocaleString("en-IN")}<span className="text-xs font-medium text-muted">/month</span></div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {i.status && <Badge tone={STATUS_TONE[i.status] || "neutral"}>{i.status[0].toUpperCase() + i.status.slice(1)}</Badge>}
                    {i.mode && <Badge tone="neutral">{i.mode}</Badge>}
                    {i.verified && <Badge tone="success"><BadgeCheck size={12} className="mr-1" /> Verified</Badge>}
                  </div>
                  {(i.duration || i.start_date) && <div className="text-xs text-muted mt-2">{i.duration || [nice(i.start_date), nice(i.end_date)].filter(Boolean).join(" – ")}</div>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
