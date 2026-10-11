"use client";

import { useEffect, useState } from "react";
import { LoadError } from "@/components/ui/States";
import { FeedbackResults, FeedbackSummary } from "@/components/feedback/FeedbackResults";
import { api } from "@/lib/api";

/** The signed-in teacher's own anonymous feedback totals. */
export function TeacherFeedback() {
  const [data, setData] = useState<FeedbackSummary | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () => {
    setFailed(false);
    api.teacherFeedback().then(setData).catch(() => setFailed(true));
  };
  useEffect(load, []);

  if (failed) return <LoadError message="We couldn't load your feedback." onRetry={load} />;
  if (!data) return <p className="text-sm text-muted text-center py-12">Loading feedback…</p>;
  return <FeedbackResults data={data} forOwner />;
}
