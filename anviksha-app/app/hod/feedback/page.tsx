"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, MessageSquareQuote } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { SimpleBarChart } from "@/components/charts/Charts";
import { FeedbackResults, FeedbackSummary, Stars } from "@/components/feedback/FeedbackResults";
import { api } from "@/lib/api";

type FacultyRow = { faculty_id: number; name: string; designation: string | null; responses: number; average: number | null; subjects: string[] };
type Overview = { department: string; responses: number; average: number | null; batches: string[]; faculty: FacultyRow[] };

export default function HodFeedbackPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  // Batch and the open faculty member live in the address, so a view can be
  // bookmarked, shared, or returned to with the browser's back button.
  const batch = params.get("batch") || "";
  const facultyId = params.get("faculty");

  const [overview, setOverview] = useState<Overview | null>(null);
  const [detail, setDetail] = useState<(FeedbackSummary & { faculty: { id: number; name: string; designation: string | null } }) | null>(null);
  const [loadError, setLoadError] = useState(false);

  const setParam = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v); else next.delete(k);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  };

  const load = () => {
    setLoadError(false);
    if (facultyId) {
      setDetail(null);
      api.hodFacultyFeedback(Number(facultyId), batch || undefined).then(setDetail).catch(() => setLoadError(true));
    } else {
      api.hodFeedback(batch || undefined).then(setOverview).catch(() => setLoadError(true));
    }
  };
  useEffect(load, [batch, facultyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = "Faculty Feedback";
  if (loadError) return <><Topbar greeting={title} subtitle="Student feedback" avatarLetter="H" /><LoadError message="We couldn't load feedback." onRetry={load} /></>;

  if (facultyId) {
    if (!detail) return <><Topbar greeting={title} subtitle="Loading…" avatarLetter="H" /><DashboardSkeleton /></>;
    return (
      <>
        <Topbar greeting={detail.faculty.name} subtitle={`Dashboard > Faculty Feedback > ${detail.faculty.name}`} avatarLetter="H" />
        <div className="p-4 md:p-8 space-y-6">
          <button onClick={() => setParam({ faculty: null })} className="inline-flex items-center gap-1.5 min-h-[44px] text-sm font-medium text-brand hover:underline">
            <ArrowLeft size={15} /> All faculty{batch ? ` · Batch ${batch}` : ""}
          </button>
          <FeedbackResults data={detail} forOwner={false} />
        </div>
      </>
    );
  }

  if (!overview) return <><Topbar greeting={title} subtitle="Loading…" avatarLetter="H" /><DashboardSkeleton /></>;
  const rated = overview.faculty.filter((f) => f.average != null).sort((a, b) => (b.average ?? 0) - (a.average ?? 0));

  return (
    <>
      <Topbar greeting={title} subtitle="Dashboard > Faculty Feedback" avatarLetter="H" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted">Anonymous student ratings for {overview.department}.</p>
          <label className="flex items-center gap-2 text-sm text-muted">
            Batch
            <select value={batch} onChange={(e) => setParam({ batch: e.target.value || null })} className="border border-gray-200 rounded-xl px-3 min-h-[44px] text-sm text-ink outline-none bg-white">
              <option value="">All batches</option>
              {overview.batches.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
        </div>

        {overview.responses === 0 ? (
          <Card hover>
            <EmptyState
              icon={MessageSquareQuote}
              title={batch ? `No feedback from batch ${batch} yet` : "No feedback submitted yet"}
              hint="Students rate their subjects from the Feedback page in their portal. Results appear here as soon as the first response arrives."
            />
          </Card>
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-4">
              <Card hover><div className="text-xs text-muted">Department average</div><div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{overview.average?.toFixed(2)}</div><Stars value={overview.average} /></Card>
              <Card hover><div className="text-xs text-muted">Responses</div><div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{overview.responses}</div></Card>
              <Card hover><div className="text-xs text-muted">Faculty with feedback</div><div className="text-3xl font-extrabold font-display text-ink numeric mt-1">{rated.length} <span className="text-base font-medium text-muted">of {overview.faculty.length}</span></div></Card>
            </div>
            {rated.length >= 2 && (
              <Card hover>
                <SectionTitle title="Faculty compared" subtitle="Average overall rating out of 5" />
                <SimpleBarChart data={rated.map((f) => ({ label: f.name, value: f.average }))} xKey="label" barKey="value" yLabel="Rating" showValues />
              </Card>
            )}
          </>
        )}

        <Card hover>
          <SectionTitle title="All faculty" subtitle="Select a name for the full breakdown and comments" />
          {overview.faculty.length === 0 ? (
            <EmptyState title="No faculty in this department yet" compact />
          ) : (
            <ul className="divide-y divide-gray-100">
              {overview.faculty.map((f) => (
                <li key={f.faculty_id}>
                  <button onClick={() => setParam({ faculty: String(f.faculty_id) })} className="w-full flex items-center gap-3 py-3 min-h-[56px] text-left hover:bg-gray-50 rounded-xl px-2 outline-none focus-visible:ring-2 focus-visible:ring-brand/30">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{f.name}</div>
                      <div className="text-xs text-muted truncate">{[f.designation, f.subjects.join(", ")].filter(Boolean).join(" · ") || "No feedback yet"}</div>
                    </div>
                    {f.average != null ? (
                      <Badge tone={f.average >= 4 ? "success" : f.average >= 3 ? "warning" : "danger"}>{f.average.toFixed(2)} · {f.responses}</Badge>
                    ) : (
                      <span className="text-xs text-muted shrink-0">No responses</span>
                    )}
                    <ChevronRight size={16} className="text-muted shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
