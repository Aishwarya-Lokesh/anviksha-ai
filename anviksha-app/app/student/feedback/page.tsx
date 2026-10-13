"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Lock, MessageSquareQuote, ShieldCheck, Star } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";

type Course = { subject_id: number; faculty_id: number; code: string; name: string; faculty_name: string | null; submitted: boolean; open?: boolean };
type Question = { key: string; label: string };

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

function RatingInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <fieldset>
      <legend className="text-sm text-ink mb-1.5">{label}</legend>
      <div className="flex items-center gap-1 flex-wrap" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} — ${RATING_WORDS[n]}`}
            onClick={() => onChange(n)}
            className="w-11 h-11 rounded-xl flex items-center justify-center hover:bg-brand-light outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Star size={24} className={n <= value ? "text-warning fill-warning" : "text-gray-300"} />
          </button>
        ))}
        <span className="text-xs text-muted ml-2 min-w-[4.5rem]">{RATING_WORDS[value] || "Not rated"}</span>
      </div>
    </fieldset>
  );
}

export default function StudentFeedbackPage() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [semester, setSemester] = useState<number | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [active, setActive] = useState<Course | null>(null);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const { push } = useToast();

  const load = () => {
    setLoadError(false);
    api.studentFeedback()
      .then((d) => { setCourses(d.courses); setQuestions(d.questions); setSemester(d.semester); })
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const open = (c: Course) => { setActive(c); setRatings({}); setComment(""); };
  const complete = questions.length > 0 && questions.every((q) => ratings[q.key] >= 1);

  const submit = async () => {
    if (!active || !complete || saving) return;
    setSaving(true);
    try {
      await api.submitFeedback({ subject_id: active.subject_id, faculty_id: active.faculty_id, ratings, comment: comment.trim() || null });
      push("Thank you — your feedback was recorded anonymously.");
      setActive(null);
      load();
    } catch (e: any) {
      push(e?.detail || "Could not submit your feedback. Please try again.", "error");
    }
    setSaving(false);
  };

  if (loadError) return <><Topbar greeting="Feedback" subtitle="Rate your subjects" avatarLetter="S" /><LoadError message="We couldn't load your subjects." onRetry={load} /></>;
  if (!courses) return <><Topbar greeting="Feedback" subtitle="Loading…" avatarLetter="S" /><DashboardSkeleton /></>;

  const pending = courses.filter((c) => !c.submitted && c.open !== false).length;
  const closed = courses.filter((c) => !c.submitted && c.open === false).length;

  return (
    <>
      <Topbar greeting="Feedback" subtitle="Dashboard > Feedback" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-brand-light">
          <ShieldCheck size={20} className="text-brand shrink-0 mt-0.5" />
          <p className="text-sm text-ink">
            <span className="font-semibold">Your feedback is anonymous.</span> Your answers are stored without your name or USN. Teachers see
            only totals, and only once at least three students have responded. A subject opens for feedback when your teacher or HOD
            switches it on — you will get a notification.
          </p>
        </div>

        <Card hover>
          <SectionTitle
            title={semester ? `Semester ${semester} subjects` : "Your subjects"}
            subtitle={courses.length === 0 ? undefined : pending > 0 ? `${pending} of ${courses.length} open for your feedback` : closed > 0 ? "No subject is open for feedback right now" : "You have given feedback for every subject"}
          />
          {courses.length === 0 ? (
            <EmptyState icon={MessageSquareQuote} title="No subjects to rate yet" hint="Subjects appear here once a teacher is assigned to them for your semester." />
          ) : (
            <ul className="space-y-2">
              {courses.map((c) => (
                <li key={`${c.subject_id}-${c.faculty_id}`} className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-100 flex-wrap">
                  <div className="flex-1 min-w-[12rem]">
                    <div className="text-sm font-medium text-ink">{c.code} — {c.name}</div>
                    <div className="text-xs text-muted">{c.faculty_name || "Teacher not recorded"}</div>
                  </div>
                  {c.submitted ? (
                    <Badge tone="success"><CheckCircle2 size={12} className="mr-1" /> Submitted</Badge>
                  ) : c.open === false ? (
                    <Badge tone="neutral"><Lock size={12} className="mr-1" /> Not open yet</Badge>
                  ) : (
                    <Button size="sm" className="min-h-[44px]" onClick={() => open(c)}>Give feedback</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CenterModal open={!!active} onClose={() => !saving && setActive(null)} title={active ? `${active.code} — ${active.faculty_name || "Feedback"}` : "Feedback"}>
        <div className="space-y-4">
          {questions.map((q) => (
            <RatingInput key={q.key} label={q.label} value={ratings[q.key] || 0} onChange={(n) => setRatings({ ...ratings, [q.key]: n })} />
          ))}
          <div>
            <label htmlFor="feedback-comment" className="text-sm text-ink mb-1.5 block">Anything else? <span className="text-muted">(optional)</span></label>
            <textarea
              id="feedback-comment"
              value={comment}
              maxLength={1000}
              rows={3}
              onChange={(e) => setComment(e.target.value)}
              placeholder="What works well, and what would help you learn better?"
              className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30"
            />
            <div className="text-[11px] text-muted text-right">{comment.length} / 1000</div>
          </div>
          <p className="text-xs text-muted">You can submit once per subject, and it can't be edited afterwards.</p>
          <Button className="w-full min-h-[44px]" disabled={!complete || saving} onClick={submit}>
            {saving ? "Submitting…" : complete ? "Submit anonymously" : "Rate every question to submit"}
          </Button>
        </div>
      </CenterModal>
    </>
  );
}
