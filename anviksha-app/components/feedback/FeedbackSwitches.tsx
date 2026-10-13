"use client";

import { useEffect, useState } from "react";
import { Card, SectionTitle } from "@/components/ui/Primitives";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";

type Row = { subject_id: number; code: string; name: string; semester: number | null; open: boolean; responses: number };

/** An on/off switch that reads as a switch to assistive technology. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="shrink-0 w-11 h-11 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-xl disabled:opacity-50"
    >
      <span className={`relative w-11 h-6 rounded-full transition-colors ${checked ? "bg-success" : "bg-gray-300"}`}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-indigo-50 shadow transition-transform ${checked ? "translate-x-5" : ""}`} />
      </span>
    </button>
  );
}

/**
 * Opens and closes feedback collection, one subject at a time. A teacher
 * controls their own subjects; an HOD (given `facultyId`) controls any
 * faculty member's subjects in the department.
 */
export function FeedbackSwitches({ facultyId }: { facultyId?: number }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const { push } = useToast();

  const load = () => {
    setFailed(false);
    (facultyId ? api.hodFeedbackWindows(facultyId) : api.teacherFeedbackWindows()).then(setRows).catch(() => setFailed(true));
  };
  useEffect(load, [facultyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = async (row: Row, open: boolean) => {
    setBusy(row.subject_id);
    try {
      await (facultyId ? api.setHodFeedbackWindow(facultyId, row.subject_id, open) : api.setTeacherFeedbackWindow(row.subject_id, open));
      setRows((list) => (list || []).map((r) => (r.subject_id === row.subject_id ? { ...r, open } : r)));
      push(open ? `Feedback is open for ${row.code}. Students have been notified.` : `Feedback is closed for ${row.code}.`);
    } catch (e: any) {
      push(e?.detail || "Could not change that. Please try again.", "error");
    }
    setBusy(null);
  };

  return (
    <Card>
      <SectionTitle
        title="Collect feedback"
        subtitle="Students can respond only while a subject is switched on. Answers already given are kept when you switch it off."
      />
      {failed ? (
        <LoadError message="We couldn't load the subjects." onRetry={load} compact />
      ) : !rows ? (
        <p className="text-sm text-muted py-4">Loading subjects…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No subjects assigned yet" hint="Subjects appear here once they are allocated to this faculty member." compact />
      ) : (
        <ul className="divide-y divide-gray-100">
          {rows.map((r) => (
            <li key={r.subject_id} className="flex items-center gap-3 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-ink truncate">{r.code} — {r.name}</div>
                <div className="text-xs text-muted">
                  {r.semester ? `Semester ${r.semester} · ` : ""}{r.responses} response{r.responses === 1 ? "" : "s"} · {r.open ? "Open to students" : "Closed"}
                </div>
              </div>
              <Switch checked={r.open} disabled={busy === r.subject_id} onChange={(next) => toggle(r, next)} label={`Collect feedback for ${r.code}`} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
