"use client";

import { useEffect, useState } from "react";
import { LoadError } from "@/components/ui/States";
import { FeedbackResults, FeedbackSummary } from "@/components/feedback/FeedbackResults";
import { FeedbackSwitches } from "@/components/feedback/FeedbackSwitches";
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

  return (
    <div className="space-y-6">
      <FeedbackSwitches />
      {failed ? (
        <LoadError message="We couldn't load your feedback." onRetry={load} />
      ) : !data ? (
        <p className="text-sm text-muted text-center py-12">Loading feedback…</p>
      ) : (
        <FeedbackResults data={data} forOwner />
      )}
    </div>
  );
}
