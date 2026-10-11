"use client";

import { MessageSquareQuote, Star, Users } from "lucide-react";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { EmptyState } from "@/components/ui/States";
import { SimpleBarChart, TrendLineChart } from "@/components/charts/Charts";

export type FeedbackSummary = {
  responses: number;
  hidden: boolean;
  average: number | null;
  min_responses: number;
  by_question: { key: string; label: string; average: number | null }[];
  subjects: {
    subject_id: number; code: string; name: string; responses: number; hidden: boolean; average: number | null;
    by_question: { key: string; label: string; average: number | null }[];
    distribution: { rating: number; count: number }[];
    comments: { text: string; rating: number; month: string | null }[];
  }[];
  trend: { label: string; average: number | null; responses: number }[];
};

export function Stars({ value, size = 14 }: { value: number | null; size?: number }) {
  const rounded = value == null ? 0 : Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={value == null ? "No rating yet" : `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size} className={n <= rounded ? "text-warning fill-warning" : "text-gray-300"} />
      ))}
    </span>
  );
}

function tone(avg: number | null): "success" | "warning" | "danger" | "neutral" {
  if (avg == null) return "neutral";
  return avg >= 4 ? "success" : avg >= 3 ? "warning" : "danger";
}

/**
 * Feedback totals for one teacher. Used on the teacher's own Performance &
 * Feedback page and on the HOD's per-faculty view; `forOwner` only changes the
 * wording of the empty and "not enough responses yet" messages.
 */
export function FeedbackResults({ data, forOwner }: { data: FeedbackSummary; forOwner: boolean }) {
  if (data.responses === 0) {
    return (
      <Card hover>
        <EmptyState
          icon={MessageSquareQuote}
          title="No feedback yet"
          hint={forOwner
            ? "When students rate your subjects from their Feedback page, the results appear here. Responses are anonymous."
            : "No student has submitted feedback for this faculty member yet."}
        />
      </Card>
    );
  }

  if (data.hidden) {
    return (
      <Card hover>
        <EmptyState
          icon={Users}
          title={`${data.responses} of ${data.min_responses} responses needed`}
          hint={`To keep students anonymous, results are shown once at least ${data.min_responses} students have responded.`}
        />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid lg:grid-cols-3 gap-6">
        <Card hover className="flex flex-col items-center justify-center text-center">
          <div className="text-4xl font-extrabold font-display text-ink numeric">{data.average?.toFixed(2)}</div>
          <div className="mt-1"><Stars value={data.average} size={18} /></div>
          <div className="text-xs text-muted mt-2">Overall rating · {data.responses} anonymous {data.responses === 1 ? "response" : "responses"}</div>
        </Card>
        <Card hover className="lg:col-span-2">
          <SectionTitle title="By question" subtitle="Average out of 5" />
          <div className="space-y-3">
            {data.by_question.map((q) => (
              <div key={q.key}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-ink">{q.label}</span>
                  <span className="font-semibold numeric text-ink">{q.average?.toFixed(2) ?? "—"}</span>
                </div>
                <div className="h-2 rounded-full bg-gray-100 overflow-hidden" role="presentation">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${((q.average ?? 0) / 5) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {data.trend.length >= 2 && (
        <Card hover>
          <SectionTitle title="Rating over time" subtitle="Average overall rating by month" />
          <TrendLineChart data={data.trend} lines={[{ key: "average", color: "#5B3FD9" }]} />
        </Card>
      )}

      {data.subjects.map((s) => (
        <Card hover key={s.subject_id}>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
            <div className="min-w-0">
              <div className="text-base font-bold text-ink">{s.code} — {s.name}</div>
              <div className="text-xs text-muted">{s.responses} {s.responses === 1 ? "response" : "responses"}</div>
            </div>
            {!s.hidden && <Badge tone={tone(s.average)}>{s.average?.toFixed(2)} / 5</Badge>}
          </div>
          {s.hidden ? (
            <p className="text-sm text-muted">Shown once at least {data.min_responses} students have responded for this subject.</p>
          ) : (
            <div className="grid lg:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-medium text-muted mb-2">Overall rating — number of responses</div>
                <SimpleBarChart data={s.distribution.map((d) => ({ label: `${d.rating}★`, value: d.count }))} xKey="label" barKey="value" yLabel="Responses" showValues />
              </div>
              <div>
                <div className="text-xs font-medium text-muted mb-2">Comments</div>
                {s.comments.length === 0 ? (
                  <p className="text-sm text-muted">No written comments for this subject.</p>
                ) : (
                  <ul className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {s.comments.map((c, i) => (
                      <li key={i} className="p-3 rounded-xl bg-gray-50">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <Stars value={c.rating} size={12} />
                          {c.month && <span className="text-[11px] text-muted">{c.month}</span>}
                        </div>
                        <p className="text-sm text-ink break-words">{c.text}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
