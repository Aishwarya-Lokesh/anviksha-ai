"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Clock, Download, FileText, NotebookPen, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { Markdown } from "@/components/ui/Markdown";
import { useToast } from "@/components/ui/Toaster";
import { api, API_BASE } from "@/lib/api";

type Item = { id: number; kind: "note" | "deadline"; title: string; body: string; subject: string | null; due_at: string | null; priority: string | null; remind: boolean; done: boolean; updated_at: string | null };
type CalEvent = { id: string; source: "mine" | "class"; title: string; subject: string | null; date: string; time: string | null; priority: string | null; done: boolean; teacher?: string | null };
type Draft = { id: number | null; kind: "note" | "deadline"; title: string; body: string; subject: string; date: string; time: string; priority: string; remind: boolean };

const TABS = [
  { key: "calendar", label: "Calendar", icon: CalendarDays },
  { key: "deadlines", label: "My deadlines", icon: Clock },
  { key: "mine", label: "My notes", icon: NotebookPen },
  { key: "class", label: "From teachers", icon: BookOpen },
];
const PRIORITY_TONE: Record<string, "danger" | "warning" | "neutral"> = { high: "danger", medium: "warning", low: "neutral" };
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const INPUT = "w-full border border-gray-200 bg-white rounded-xl px-3.5 min-h-[44px] text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30";

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function niceDate(date: string, time?: string | null) {
  const d = new Date(`${date}T${time || "00:00"}`);
  const day = d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return time ? `${day}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : day;
}

function dueLabel(date: string, today: string): { text: string; tone: "danger" | "warning" | "brand" } {
  const days = Math.round((new Date(`${date}T00:00`).getTime() - new Date(`${today}T00:00`).getTime()) / 86400000);
  if (days < 0) return { text: days === -1 ? "1 day overdue" : `${-days} days overdue`, tone: "danger" };
  if (days === 0) return { text: "Due today", tone: "danger" };
  if (days === 1) return { text: "Due tomorrow", tone: "warning" };
  return { text: `${days} days left`, tone: days <= 7 ? "warning" : "brand" };
}

const emptyDraft = (kind: "note" | "deadline", date = ""): Draft => ({ id: null, kind, title: "", body: "", subject: "", date, time: "17:00", priority: "medium", remind: true });

export default function NotesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = TABS.some((t) => t.key === params.get("tab")) ? (params.get("tab") as string) : "calendar";
  const { push } = useToast();

  const [planner, setPlanner] = useState<{ notes: Item[]; deadlines: Item[] } | null>(null);
  const [calendar, setCalendar] = useState<{ events: CalEvent[]; due_soon: CalEvent[]; overdue: CalEvent[]; today: string } | null>(null);
  const [fromClass, setFromClass] = useState<{ notes: any[]; deadlines: any[] } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Item | null>(null);
  const [reading, setReading] = useState<Item | null>(null);
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selectedDay, setSelectedDay] = useState<string>(() => ymd(new Date()));

  const load = () => {
    setLoadError(false);
    Promise.all([api.planner(), api.studentCalendar(), api.studentNotes()])
      .then(([p, c, n]) => { setPlanner(p); setCalendar(c); setFromClass(n); })
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const setTab = (key: string) => router.replace(key === "calendar" ? pathname : `${pathname}?tab=${key}`);

  const edit = (i: Item) => setDraft({
    id: i.id, kind: i.kind, title: i.title, body: i.body || "", subject: i.subject || "",
    date: i.due_at ? i.due_at.slice(0, 10) : "", time: i.due_at ? i.due_at.slice(11, 16) : "17:00", priority: i.priority || "medium", remind: i.remind,
  });

  const save = async () => {
    if (!draft || saving) return;
    if (!draft.title.trim()) { push("Give it a title first.", "error"); return; }
    if (draft.kind === "deadline" && !draft.date) { push("Choose the due date.", "error"); return; }
    setSaving(true);
    const payload: Record<string, unknown> = draft.kind === "note"
      ? { kind: "note", title: draft.title, body: draft.body, subject: draft.subject }
      : { kind: "deadline", title: draft.title, body: draft.body, subject: draft.subject, due_at: `${draft.date}T${draft.time || "17:00"}`, priority: draft.priority, remind: draft.remind };
    try {
      if (draft.id) await api.editPlannerItem(draft.id, payload); else await api.addPlannerItem(payload);
      push(draft.kind === "note" ? "Note saved" : "Deadline saved");
      setDraft(null);
      load();
    } catch (e: any) {
      push(e?.detail || "Could not save. Please try again.", "error");
    }
    setSaving(false);
  };

  const toggleDone = async (i: Item) => {
    setPlanner((p) => p && { ...p, deadlines: p.deadlines.map((d) => (d.id === i.id ? { ...d, done: !i.done } : d)) });
    try { await api.editPlannerItem(i.id, { done: !i.done }); load(); } catch { push("Could not update that deadline.", "error"); load(); }
  };

  const remove = async () => {
    if (!toDelete) return;
    try { await api.deletePlannerItem(toDelete.id); push("Deleted"); setToDelete(null); setReading(null); load(); }
    catch { push("Could not delete. Please try again.", "error"); }
  };

  const eventsByDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    for (const e of calendar?.events || []) (map[e.date] ||= []).push(e);
    return map;
  }, [calendar]);

  const cells = useMemo(() => {
    const first = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7; // weeks start on Monday
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (string | null)[] = Array(offset).fill(null);
    for (let d = 1; d <= days; d++) out.push(ymd(new Date(month.getFullYear(), month.getMonth(), d)));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const title = "Notes & Deadlines";
  if (loadError) return <><Topbar greeting={title} subtitle="Your planner" avatarLetter="S" /><LoadError message="We couldn't load your notes and deadlines." onRetry={load} /></>;
  if (!planner || !calendar || !fromClass) return <><Topbar greeting={title} subtitle="Loading…" avatarLetter="S" /><DashboardSkeleton /></>;

  const today = calendar.today;
  const shownNotes = planner.notes.filter((n) => !query.trim() || `${n.title} ${n.subject || ""} ${n.body}`.toLowerCase().includes(query.trim().toLowerCase()));
  const openDeadlines = planner.deadlines.filter((d) => !d.done);
  const doneDeadlines = planner.deadlines.filter((d) => d.done);
  const dayEvents = eventsByDay[selectedDay] || [];

  return (
    <>
      <Topbar greeting={title} subtitle="Dashboard > Notes & Deadlines" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div role="tablist" aria-label="Planner sections" className="flex gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto max-w-full">
            {TABS.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg text-xs font-semibold whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${tab === t.key ? "bg-brand text-white" : "text-muted hover:text-ink"}`}
              >
                <t.icon size={14} /> {t.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="min-h-[44px]" onClick={() => setDraft(emptyDraft("note"))}><Plus size={15} /> Note</Button>
            <Button className="min-h-[44px]" onClick={() => setDraft(emptyDraft("deadline", tab === "calendar" ? selectedDay : ""))}><Plus size={15} /> Deadline</Button>
          </div>
        </div>

        {(calendar.overdue.length > 0 || calendar.due_soon.length > 0) && tab !== "class" && (
          <div className="flex items-start gap-3 p-4 rounded-2xl bg-warning/10">
            <Bell size={18} className="text-[#9c6b12] shrink-0 mt-0.5" />
            <p className="text-sm text-ink">
              {calendar.overdue.length > 0 && <><span className="font-semibold">{calendar.overdue.length} overdue.</span>{" "}</>}
              {calendar.due_soon.length > 0 && <><span className="font-semibold">{calendar.due_soon.length} due in the next 7 days</span>: {calendar.due_soon.slice(0, 3).map((e) => e.title).join(", ")}{calendar.due_soon.length > 3 ? "…" : ""}</>}
            </p>
          </div>
        )}

        {tab === "calendar" && (
          <div className="grid lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 !p-4 md:!p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-ink">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</h2>
                <div className="flex items-center gap-1">
                  <button aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="w-11 h-11 rounded-xl hover:bg-gray-100 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><ChevronLeft size={18} /></button>
                  <button onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setSelectedDay(today); }} className="px-3 min-h-[44px] rounded-xl text-xs font-semibold text-brand hover:bg-brand-light outline-none focus-visible:ring-2 focus-visible:ring-brand/40">Today</button>
                  <button aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="w-11 h-11 rounded-xl hover:bg-gray-100 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><ChevronRight size={18} /></button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold text-muted mb-1">{WEEKDAYS.map((w) => <div key={w}>{w}</div>)}</div>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                  if (!day) return <div key={`blank-${i}`} />;
                  const events = eventsByDay[day] || [];
                  const selected = day === selectedDay;
                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDay(day)}
                      aria-pressed={selected}
                      aria-label={`${niceDate(day)}${events.length ? `, ${events.length} item${events.length === 1 ? "" : "s"}` : ""}`}
                      className={`relative min-h-[48px] md:min-h-[64px] rounded-xl p-1 flex flex-col items-center md:items-start text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand/40 transition-colors ${
                        selected ? "bg-brand text-white" : day === today ? "bg-brand-light text-brand font-bold" : "hover:bg-gray-50 text-ink"
                      }`}
                    >
                      <span className="md:pl-1 numeric">{Number(day.slice(8))}</span>
                      {events.length > 0 && (
                        <span className="mt-auto flex gap-0.5 md:pl-1 pb-0.5">
                          {events.slice(0, 3).map((e) => (
                            <span key={e.id} className={`w-1.5 h-1.5 rounded-full ${selected ? "bg-white" : e.done ? "bg-gray-300" : e.source === "class" ? "bg-info" : e.priority === "high" ? "bg-danger" : "bg-brand"}`} />
                          ))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-4 text-xs text-muted">
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-brand" /> My deadline</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-danger" /> High priority</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-info" /> Set by a teacher</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-gray-300" /> Done</span>
              </div>
            </Card>
            <Card>
              <SectionTitle title={niceDate(selectedDay)} subtitle={dayEvents.length ? `${dayEvents.length} item${dayEvents.length === 1 ? "" : "s"}` : undefined} />
              {dayEvents.length === 0 ? (
                <EmptyState icon={CalendarDays} title="Nothing due on this day" compact action={<Button size="sm" variant="secondary" className="min-h-[44px]" onClick={() => setDraft(emptyDraft("deadline", selectedDay))}><Plus size={14} /> Add a deadline</Button>} />
              ) : (
                <ul className="space-y-2">
                  {dayEvents.map((e) => (
                    <li key={e.id} className="p-3 rounded-xl border border-gray-100">
                      <div className={`text-sm font-medium ${e.done ? "line-through text-muted" : "text-ink"}`}>{e.title}</div>
                      <div className="text-xs text-muted mt-0.5">{[e.time, e.subject, e.source === "class" ? `Set by ${e.teacher || "your teacher"}` : "Mine"].filter(Boolean).join(" · ")}</div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}

        {tab === "deadlines" && (
          <Card>
            <SectionTitle title="My deadlines" subtitle="Only you can see these" />
            {planner.deadlines.length === 0 ? (
              <EmptyState icon={Clock} title="No deadlines yet" hint="Add assignments, record submissions or exam dates so nothing slips." action={<Button className="min-h-[44px]" onClick={() => setDraft(emptyDraft("deadline"))}><Plus size={15} /> Add a deadline</Button>} />
            ) : (
              <ul className="space-y-2">
                {[...openDeadlines, ...doneDeadlines].map((d) => {
                  const date = (d.due_at || "").slice(0, 10);
                  const due = dueLabel(date, today);
                  return (
                    <li key={d.id} className="flex items-start gap-2 p-3 rounded-xl border border-gray-100">
                      <button
                        role="checkbox"
                        aria-checked={d.done}
                        aria-label={d.done ? `Mark ${d.title} as not done` : `Mark ${d.title} as done`}
                        onClick={() => toggleDone(d)}
                        className="w-11 h-11 -m-1 shrink-0 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40 rounded-xl"
                      >
                        <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center ${d.done ? "bg-success border-success" : "border-gray-300"}`}>{d.done && <Check size={13} className="text-white" />}</span>
                      </button>
                      <div className="flex-1 min-w-0 pt-1">
                        <div className={`text-sm font-medium break-words ${d.done ? "line-through text-muted" : "text-ink"}`}>{d.title}</div>
                        <div className="text-xs text-muted mt-0.5">{[d.subject, niceDate(date, (d.due_at || "").slice(11, 16))].filter(Boolean).join(" · ")}</div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          {!d.done && <Badge tone={due.tone}>{due.text}</Badge>}
                          {d.done && <Badge tone="success">Done</Badge>}
                          {d.priority && <Badge tone={PRIORITY_TONE[d.priority] || "neutral"}>{d.priority[0].toUpperCase() + d.priority.slice(1)} priority</Badge>}
                          {d.remind && !d.done && <Badge tone="neutral"><Bell size={11} className="mr-1" /> Reminder on</Badge>}
                        </div>
                        {d.body && <p className="text-xs text-muted mt-1.5 whitespace-pre-wrap break-words">{d.body}</p>}
                      </div>
                      <button aria-label={`Edit ${d.title}`} onClick={() => edit(d)} className="w-11 h-11 shrink-0 rounded-xl text-muted hover:text-brand hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Pencil size={15} /></button>
                      <button aria-label={`Delete ${d.title}`} onClick={() => setToDelete(d)} className="w-11 h-11 shrink-0 rounded-xl text-muted hover:text-danger hover:bg-gray-50 flex items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Trash2 size={15} /></button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}

        {tab === "mine" && (
          <Card>
            <SectionTitle title="My notes" subtitle="Only you can see these" />
            {planner.notes.length === 0 ? (
              <EmptyState icon={NotebookPen} title="No notes yet" hint="Keep revision plans, formulas or to-dos here. Simple formatting is supported: **bold**, lists and headings." action={<Button className="min-h-[44px]" onClick={() => setDraft(emptyDraft("note"))}><Plus size={15} /> Write a note</Button>} />
            ) : (
              <>
                <label className="relative block mb-4 max-w-md">
                  <span className="sr-only">Search my notes</span>
                  <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search my notes" className={`${INPUT} pl-10`} />
                </label>
                {shownNotes.length === 0 ? (
                  <EmptyState icon={Search} title={`No note matches "${query}"`} compact />
                ) : (
                  <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                    {shownNotes.map((n) => (
                      <li key={n.id}>
                        <button onClick={() => setReading(n)} className="w-full h-full text-left p-4 rounded-2xl border border-gray-100 hover:border-brand/40 hover:bg-brand-50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                          <div className="text-sm font-semibold text-ink break-words">{n.title}</div>
                          {n.subject && <Badge tone="brand" className="mt-1.5">{n.subject}</Badge>}
                          <p className="text-xs text-muted mt-2 line-clamp-4 whitespace-pre-wrap break-words">{n.body.replace(/[#*_`>-]/g, "") || "No text yet"}</p>
                          <div className="text-[11px] text-muted mt-3">Updated {n.updated_at?.slice(0, 10)}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </Card>
        )}

        {tab === "class" && (
          <div className="grid lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <SectionTitle title="Subject notes" subtitle="Shared by your teachers with your class" />
              {fromClass.notes.length === 0 ? (
                <EmptyState icon={FileText} title="No notes shared yet" hint="Study material your teachers post for your class will appear here." />
              ) : (
                <ul className="space-y-2">
                  {fromClass.notes.map((n: any) => (
                    <li key={n.id} className="flex items-center gap-3 p-3.5 rounded-xl border border-gray-100">
                      <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center shrink-0"><FileText size={18} className="text-brand" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink truncate">{n.title}</div>
                        <div className="text-xs text-muted truncate">{[n.subject, n.teacher_name, n.created_at?.slice(0, 10)].filter(Boolean).join(" · ")}</div>
                        {n.description && <div className="text-xs text-muted mt-0.5 line-clamp-2">{n.description}</div>}
                      </div>
                      {n.file_url ? (
                        <a href={`${API_BASE}${n.file_url}`} target="_blank" rel="noreferrer" aria-label={`Download ${n.title}`} className="w-11 h-11 rounded-xl text-brand hover:bg-brand-light flex items-center justify-center shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-brand/40"><Download size={17} /></a>
                      ) : (
                        <span className="text-[11px] text-muted shrink-0">No file</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <SectionTitle title="Class deadlines" subtitle="Set by your teachers" />
              {fromClass.deadlines.length === 0 ? (
                <EmptyState icon={Clock} title="No class deadlines" compact />
              ) : (
                <ul className="space-y-3">
                  {[...fromClass.deadlines].sort((a: any, b: any) => (a.due_date < b.due_date ? -1 : 1)).map((d: any) => {
                    const due = d.due_date ? dueLabel(d.due_date, today) : null;
                    return (
                      <li key={d.id} className="p-3 rounded-xl border border-gray-100">
                        <div className="text-sm font-medium text-ink">{d.title}</div>
                        <div className="text-xs text-muted mb-1.5">{[d.subject, d.teacher_name, d.due_date].filter(Boolean).join(" · ")}</div>
                        {due && <Badge tone={due.text.includes("overdue") ? "neutral" : due.tone}>{due.text.includes("overdue") ? "Past" : due.text}</Badge>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          </div>
        )}
      </div>

      <CenterModal open={!!draft} onClose={() => !saving && setDraft(null)} title={draft ? `${draft.id ? "Edit" : "New"} ${draft.kind}` : ""}>
        {draft && (
          <div className="space-y-3">
            <div>
              <label htmlFor="pl-title" className="text-xs font-medium text-muted mb-1 block">Title</label>
              <input id="pl-title" autoFocus value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={draft.kind === "note" ? "e.g. DBMS unit 3 revision" : "e.g. Submit mini project report"} className={INPUT} />
            </div>
            <div>
              <label htmlFor="pl-subject" className="text-xs font-medium text-muted mb-1 block">Subject <span className="font-normal">(optional)</span></label>
              <input id="pl-subject" value={draft.subject} maxLength={120} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} placeholder="e.g. Computer Networks" className={INPUT} />
            </div>
            {draft.kind === "deadline" && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pl-date" className="text-xs font-medium text-muted mb-1 block">Due date</label>
                    <input id="pl-date" type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className={INPUT} />
                  </div>
                  <div>
                    <label htmlFor="pl-time" className="text-xs font-medium text-muted mb-1 block">Time</label>
                    <input id="pl-time" type="time" value={draft.time} onChange={(e) => setDraft({ ...draft, time: e.target.value })} className={INPUT} />
                  </div>
                </div>
                <fieldset>
                  <legend className="text-xs font-medium text-muted mb-1">Priority</legend>
                  <div className="grid grid-cols-3 gap-2">
                    {["low", "medium", "high"].map((p) => (
                      <button key={p} type="button" aria-pressed={draft.priority === p} onClick={() => setDraft({ ...draft, priority: p })} className={`min-h-[44px] rounded-xl text-sm font-semibold border-2 outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${draft.priority === p ? "border-brand bg-brand-light text-brand" : "border-gray-100 text-muted"}`}>
                        {p[0].toUpperCase() + p.slice(1)}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <label className="flex items-center gap-3 min-h-[44px] text-sm text-ink cursor-pointer">
                  <input type="checkbox" checked={draft.remind} onChange={(e) => setDraft({ ...draft, remind: e.target.checked })} className="w-5 h-5 accent-[#5B3FD9]" />
                  Send me a notification a day before it is due
                </label>
              </>
            )}
            <div>
              <label htmlFor="pl-body" className="text-xs font-medium text-muted mb-1 block">{draft.kind === "note" ? "Note" : "Details"} <span className="font-normal">{draft.kind === "note" ? "(supports **bold**, # headings and - lists)" : "(optional)"}</span></label>
              <textarea id="pl-body" value={draft.body} rows={draft.kind === "note" ? 9 : 3} onChange={(e) => setDraft({ ...draft, body: e.target.value })} className="w-full border border-gray-200 bg-white rounded-xl px-3.5 py-2.5 text-sm text-ink outline-none focus:ring-2 focus:ring-brand/30" />
            </div>
            <Button className="w-full min-h-[44px]" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        )}
      </CenterModal>

      <CenterModal open={!!reading} onClose={() => setReading(null)} title={reading?.title || ""} width="max-w-2xl">
        {reading && (
          <div>
            {reading.subject && <Badge tone="brand" className="mb-3">{reading.subject}</Badge>}
            {reading.body ? <Markdown text={reading.body} /> : <p className="text-sm text-muted">This note has no text yet.</p>}
            <div className="flex gap-2 mt-6">
              <Button variant="secondary" className="flex-1 min-h-[44px]" onClick={() => { edit(reading); setReading(null); }}><Pencil size={14} /> Edit</Button>
              <Button variant="danger" className="flex-1 min-h-[44px]" onClick={() => setToDelete(reading)}><Trash2 size={14} /> Delete</Button>
            </div>
          </div>
        )}
      </CenterModal>

      <CenterModal open={!!toDelete} onClose={() => setToDelete(null)} title={`Delete this ${toDelete?.kind || "item"}?`} width="max-w-sm">
        <p className="text-sm text-muted mb-5">"{toDelete?.title}" will be removed for good. This can't be undone.</p>
        <div className="flex gap-2">
          <Button variant="ghost" className="flex-1 min-h-[44px]" onClick={() => setToDelete(null)}>Cancel</Button>
          <Button variant="danger" className="flex-1 min-h-[44px]" onClick={remove}>Delete</Button>
        </div>
      </CenterModal>
    </>
  );
}
