"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Download, GraduationCap, Search, Users } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button } from "@/components/ui/Primitives";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { api } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";

type Offer = { usn: string; name: string; company: string; package_lpa: number | null; offer_type: string | null };
type Internship = { usn: string; name: string; company: string; stipend_per_month: number | null };
type Data = { students: number; placed: number; offers: Offer[]; internships?: Internship[] };

export default function TeacherPlacementsPage() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");

  const load = () => {
    setFailed(false);
    api.teacherPlacements().then(setData).catch(() => setFailed(true));
  };
  useEffect(load, []);

  const needle = query.trim().toLowerCase();
  const offers = useMemo(() => (data?.offers || []).filter((o) => !needle || `${o.usn} ${o.name} ${o.company}`.toLowerCase().includes(needle)).sort((a, b) => (b.package_lpa || 0) - (a.package_lpa || 0)), [data, needle]);
  const internships = useMemo(() => (data?.internships || []).filter((o) => !needle || `${o.usn} ${o.name} ${o.company}`.toLowerCase().includes(needle)), [data, needle]);

  const title = "My Students' Placements";
  if (failed) return <><Topbar greeting={title} subtitle="Offers and internships" avatarLetter="T" /><LoadError message="We couldn't load placement details." onRetry={load} /></>;
  if (!data) return <><Topbar greeting={title} subtitle="Loading…" avatarLetter="T" /><DashboardSkeleton /></>;

  const packages = data.offers.map((o) => o.package_lpa).filter((p): p is number => p != null);
  const highest = packages.length ? Math.max(...packages) : null;
  const percent = data.students ? Math.round((data.placed / data.students) * 100) : 0;

  return (
    <>
      <Topbar greeting={title} subtitle="Dashboard > Placements" avatarLetter="T" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card><div className="text-xs text-muted">My students</div><div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{data.students}</div></Card>
          <Card><div className="text-xs text-muted">Placed</div><div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{data.placed} <span className="text-base font-medium text-muted">({percent}%)</span></div></Card>
          <Card><div className="text-xs text-muted">Highest package</div><div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{highest != null ? `${highest} LPA` : "—"}</div></Card>
          <Card><div className="text-xs text-muted">Internships</div><div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{(data.internships || []).length}</div></Card>
        </div>

        {data.students === 0 ? (
          <Card><EmptyState icon={Users} title="No students are linked to you yet" hint="Add a teaching assignment from your dashboard. Your students' offers and internships then appear here." /></Card>
        ) : (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <label className="relative flex-1 min-w-[13rem] max-w-md">
                <span className="sr-only">Search</span>
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search student or company" className="w-full border border-gray-200 bg-white rounded-xl pl-10 pr-3.5 min-h-[44px] text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30" />
              </label>
              <Button variant="secondary" className="min-h-[44px] ml-auto" disabled={offers.length === 0} onClick={() => downloadCsv("my_students_offers", ["USN", "Name", "Company", "Package (LPA)", "Offer type"], offers.map((o) => [o.usn, o.name, o.company, o.package_lpa, o.offer_type]))}><Download size={14} /> Export offers</Button>
            </div>

            <Card className="!p-0 overflow-hidden">
              <div className="px-5 pt-5"><SectionTitle title="Offers" subtitle="Students in the classes you teach. Only the placement cell and HOD can change these." /></div>
              {offers.length === 0 ? (
                <EmptyState icon={Briefcase} title={needle ? "No offer matches your search" : "No offers recorded for your students yet"} compact />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead><tr className="text-left text-xs text-muted border-b border-gray-100"><th className="py-2.5 pl-5 pr-3 font-medium">Student</th><th className="py-2.5 pr-3 font-medium">Company</th><th className="py-2.5 pr-3 font-medium">Package</th><th className="py-2.5 pr-5 font-medium">Type</th></tr></thead>
                    <tbody>
                      {offers.map((o, i) => (
                        <tr key={`${o.usn}-${o.company}-${i}`} className="border-b border-gray-100 last:border-0">
                          <td className="py-2.5 pl-5 pr-3"><div className="font-medium text-ink">{o.name}</div><div className="text-xs text-muted">{o.usn}</div></td>
                          <td className="py-2.5 pr-3 text-ink">{o.company}</td>
                          <td className="py-2.5 pr-3 font-semibold text-ink numeric whitespace-nowrap">{o.package_lpa != null ? `${o.package_lpa} LPA` : "—"}</td>
                          <td className="py-2.5 pr-5 text-ink">{o.offer_type || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="!p-0 overflow-hidden">
              <div className="px-5 pt-5"><SectionTitle title="Internships" /></div>
              {internships.length === 0 ? (
                <EmptyState icon={GraduationCap} title={needle ? "No internship matches your search" : "No internships recorded for your students yet"} compact />
              ) : (
                <ul className="divide-y divide-gray-100">
                  {internships.map((o, i) => (
                    <li key={`${o.usn}-${o.company}-${i}`} className="flex items-center gap-3 px-5 py-2.5">
                      <div className="flex-1 min-w-0"><div className="text-sm font-medium text-ink truncate">{o.name}</div><div className="text-xs text-muted">{o.usn} · {o.company}</div></div>
                      {o.stipend_per_month != null && <div className="text-sm font-semibold text-ink numeric shrink-0">₹{Number(o.stipend_per_month).toLocaleString("en-IN")}/mo</div>}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </>
        )}
      </div>
    </>
  );
}
