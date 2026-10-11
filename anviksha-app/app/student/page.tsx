"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { StatCard } from "@/components/ui/StatCard";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { TrendLineChart, DonutChart, StudentRadarChart } from "@/components/charts/Charts";
import { AskAIBar } from "@/components/ui/AskAI";
import { AIInsightCard } from "@/components/ui/AIInsightCard";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { GraduationCap, CalendarCheck, Star, Award, AlertCircle, Calendar, Trophy, UserPlus, FileEdit, MessageSquare, Briefcase, Users, Inbox } from "lucide-react";
import { LoadError, EmptyState } from "@/components/ui/States";
import { useRouter } from "next/navigation";
import { api, consumeJustLoggedIn } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { Celebration } from "@/components/ui/Celebration";

const CELEBRATION_CGPA_THRESHOLD = 8.5;

const ATTENDANCE_BUCKETS = [
  { key: "excellent", name: "Excellent (90%+)", color: "#1F9D55", min: 90 },
  { key: "good", name: "Good (75-89%)", color: "#3B82F6", min: 75 },
  { key: "average", name: "Average (60-74%)", color: "#E8A93B", min: 60 },
  { key: "low", name: "Low (<60%)", color: "#E5484D", min: 0 },
];

function bucketAttendance(subjects: { pct: number | null }[]) {
  const counts = { excellent: 0, good: 0, average: 0, low: 0 };
  for (const s of subjects) {
    if (s.pct == null) continue;
    if (s.pct >= 90) counts.excellent++;
    else if (s.pct >= 75) counts.good++;
    else if (s.pct >= 60) counts.average++;
    else counts.low++;
  }
  return ATTENDANCE_BUCKETS.map((b) => ({ name: b.name, value: counts[b.key as keyof typeof counts], color: b.color }));
}

const ACH_ICON: Record<string, any> = { Certificate: Award, Hackathon: Trophy, Project: Briefcase, Activity: Users };

// Groups shown when the Achievements card is opened — Certificates and Projects
// first, since those are what the card counts out.
const ACH_GROUPS = [
  { type: "Certificate", plural: "Certificates" },
  { type: "Project", plural: "Projects" },
  { type: "Hackathon", plural: "Hackathons" },
  { type: "Activity", plural: "Activities" },
];

export default function StudentDashboard() {
  const { push } = useToast();
  const router = useRouter();
  const [sgpaTrend, setSgpaTrend] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [excellence, setExcellence] = useState<any>(null);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [showAchievements, setShowAchievements] = useState(false);
  const [attendance, setAttendance] = useState<any>(null);
  const [showAttendance, setShowAttendance] = useState(false);
  const [deadlines, setDeadlines] = useState<any[] | null>(null);
  const [celebrate, setCelebrate] = useState(false);

  // Every achievement on record — the student's own added achievements plus the
  // certificate/proof files on their record, i.e. exactly what the Achievements
  // section lists and exactly what the Excellence Score is computed from.
  const achievementItems: any[] = profile?.achievementItems ?? [];
  const byType = (t: string) => achievementItems.filter((a) => a.type === t);

  // Only deadlines that haven't passed yet, soonest first — a due date that's
  // already gone isn't an "upcoming" event.
  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingDeadlines = (deadlines || [])
    .filter((d: any) => d.due_date && d.due_date >= todayStr)
    .sort((a: any, b: any) => (a.due_date < b.due_date ? -1 : 1));

  useEffect(() => {
    api.excellenceScore().then(setExcellence).catch(() => {});
    api.myAttendance().then(setAttendance).catch(() => {});
    api.studentNotes().then((d) => setDeadlines(d.deadlines || [])).catch(() => setDeadlines([]));
  }, []);

  const loadProfile = () => {
    setLoadFailed(false);
    api.studentDashboard()
      .then((d) => {
        setProfile({
          name: d.name, cgpa: d.cgpa, attendance: d.attendance_pct, // may be null — real gap, not fabricated
          // Live-computed, and identical to the Student Excellence Score —
          // both come from the same CGPA tier + achievement point calculation.
          profileScore: d.profile_score,
          achievementsCount: d.achievements_count ?? 0,
          achievementsBreakdown: d.achievements_breakdown ?? null,
          achievementItems: d.achievement_items ?? [],
          backlogs: d.backlogs,
        });
        if (d.semester_sgpa && Object.keys(d.semester_sgpa).length > 0) {
          const real = Object.entries(d.semester_sgpa)
            .map(([sem, vals]: [string, any]) => ({ label: `Sem ${sem}`, sem: parseInt(sem), sgpa: vals.sgpa }))
            .filter((r) => r.sgpa != null)
            .sort((a, b) => a.sem - b.sem);
          if (real.length > 0) setSgpaTrend(real);
        }
        setLiveMode(true);
        // Only ever fires right after a real login (the flag is set exactly
        // once by setAuth and consumed here), never on a plain page revisit.
        if ((d.cgpa ?? 0) > CELEBRATION_CGPA_THRESHOLD && consumeJustLoggedIn()) {
          setCelebrate(true);
        }
      })
      .catch(() => { setLiveMode(false); setLoadFailed(true); });
  };
  useEffect(loadProfile, []);

  if (loadFailed && !profile) return <><Topbar greeting="Dashboard" subtitle="Your academic overview" avatarLetter="S" /><LoadError message="We couldn't load your dashboard." onRetry={loadProfile} /></>;
  if (!profile) return <><Topbar greeting="Loading..." subtitle="Loading your dashboard…" avatarLetter="S" /><DashboardSkeleton /></>;

  return (
    <>
      <Celebration active={celebrate} onDone={() => setCelebrate(false)} />
      <Topbar greeting={`Welcome back, ${profile.name.split(" ")[0]}! 👋`} subtitle="Here's your academic and professional overview." avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-6">
        {liveMode && <AIInsightCard fetcher={api.studentInsight} />}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Current CGPA" value={profile.cgpa} decimals={2} icon={GraduationCap} tone="brand" delay={0} />
          {(attendance?.overall_pct ?? profile.attendance) != null ? (
            <StatCard
              label="Avg Attendance"
              value={attendance?.overall_pct ?? profile.attendance}
              suffix="%"
              icon={CalendarCheck}
              tone="info"
              delay={0.05}
              onClick={() => setShowAttendance(true)}
              link="View by subject →"
            />
          ) : (
            <Card hover className="flex flex-col items-center justify-center text-center">
              <CalendarCheck size={20} className="text-muted mb-2" />
              <div className="text-sm font-semibold text-muted">Not Available</div>
              <div className="text-xs text-muted">Attendance data</div>
            </Card>
          )}
          <StatCard
            label="Profile Score"
            value={profile.profileScore}
            suffix=" pts"
            icon={Star}
            tone="success"
            link="Same as Excellence Score →"
            onClick={excellence ? () => setShowBreakdown(true) : undefined}
            delay={0.1}
          />
          <StatCard
            label="Achievements"
            value={profile.achievementsCount}
            icon={Award}
            tone="warning"
            link={
              profile.achievementsBreakdown
                ? `${profile.achievementsBreakdown.certificates} Certificates · ${profile.achievementsBreakdown.projects} Projects`
                : undefined
            }
            onClick={() => setShowAchievements(true)}
            delay={0.15}
          />
          <StatCard label="Backlogs" value={profile.backlogs} icon={AlertCircle} tone="danger" delay={0.2} />
        </div>

        {excellence && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <button onClick={() => setShowBreakdown(true)} className="w-full text-left bg-gradient-to-r from-brand to-[#7A5FEA] rounded-2xl p-6 text-white hover:shadow-cardHover transition-shadow">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center text-2xl">🏆</div>
                  <div>
                    <div className="text-sm font-semibold text-white/80">Student Excellence Score</div>
                    <div className="text-3xl font-extrabold font-display numeric">{excellence.total_score} <span className="text-base font-medium text-white/70">Points</span></div>
                    <div className="text-xs text-white/70 mt-1">Academic + Achievements</div>
                  </div>
                </div>
                <span className="text-sm font-semibold flex items-center gap-1">View Point Breakdown →</span>
              </div>
            </button>
          </motion.div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2" hover>
            <SectionTitle title="SGPA Trend" subtitle="Semester-wise progress" />
            {sgpaTrend.length === 0 ? (
              <EmptyState title="No semester results on record yet" hint="Your SGPA trend appears here once results are entered." compact />
            ) : (
              <TrendLineChart data={sgpaTrend} lines={[{ key: "sgpa", color: "#5B3FD9" }]} />
            )}
          </Card>
          <Card hover>
            <SectionTitle title="Attendance Overview" />
            {attendance === null ? (
              <div className="h-[230px] flex items-center justify-center text-xs text-muted">Loading...</div>
            ) : !attendance.subjects || attendance.subjects.length === 0 ? (
              <div className="h-[230px] flex flex-col items-center justify-center text-center gap-2">
                <CalendarCheck size={26} className="text-muted opacity-50" />
                <p className="text-sm font-medium text-muted">Your attendance is not updated</p>
                <p className="text-xs text-muted">No attendance sessions have been recorded for you yet.</p>
              </div>
            ) : (
              <>
                <DonutChart
                  data={bucketAttendance(attendance.subjects)}
                  centerValue={attendance.overall_pct != null ? `${attendance.overall_pct}%` : "N/A"}
                  centerLabel="Overall"
                />
                <div className="space-y-1.5 mt-2">
                  {bucketAttendance(attendance.subjects).map((a) => (
                    <div key={a.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-muted"><span className="w-2 h-2 rounded-full" style={{ background: a.color }} />{a.name}</span>
                      <span className="font-semibold text-ink">{a.value} Subjects</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Card>
        </div>

        {liveMode && profile && (
          <div className="grid lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1" hover>
              <SectionTitle title="Academic Profile" subtitle="Your metrics, normalized to a 0-100 scale for comparison" />
              <StudentRadarChart data={[
                { metric: "CGPA", value: Math.round(((profile.cgpa ?? 0) / 10) * 100), fullMark: 100 },
                { metric: "Attendance", value: Math.round(profile.attendance ?? 0), fullMark: 100 },
                { metric: "Profile Score", value: Math.min(100, Math.round((profile.profileScore ?? 0) / 10)), fullMark: 100 },
                { metric: "Achievements", value: Math.min(100, (profile.achievementsCount ?? 0) * 20), fullMark: 100 },
                { metric: "Backlog-free", value: Math.max(0, 100 - (profile.backlogs ?? 0) * 20), fullMark: 100 },
              ]} />
            </Card>
          </div>
        )}

        <div className="grid lg:grid-cols-3 gap-6">
          <Card hover>
            <SectionTitle title="Upcoming Events" subtitle="From your teachers' deadlines" />
            <div className="space-y-3">
              {deadlines === null && <div className="text-xs text-muted py-4 text-center">Loading...</div>}
              {deadlines !== null && upcomingDeadlines.length === 0 && (
                <div className="text-center py-6">
                  <Inbox size={22} className="text-muted mx-auto mb-2 opacity-50" />
                  <p className="text-sm text-muted">None</p>
                </div>
              )}
              {upcomingDeadlines.slice(0, 4).map((e: any, i: number) => (
                <motion.div key={e.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-brand-light flex items-center justify-center shrink-0"><Calendar size={16} className="text-brand" /></div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-ink truncate">{e.title}</div>
                    <div className="text-xs text-muted">{e.subject ? `${e.subject} · ` : ""}{e.due_date}</div>
                  </div>
                </motion.div>
              ))}
              {upcomingDeadlines.length > 4 && (
                <button onClick={() => router.push("/student/notes")} className="w-full text-xs font-semibold text-brand hover:underline pt-1">
                  View all {upcomingDeadlines.length} →
                </button>
              )}
            </div>
          </Card>
          <Card hover>
            <SectionTitle title="Recent Achievements" subtitle={achievementItems.length > 3 ? `Showing 3 of ${achievementItems.length}` : undefined} />
            <div className="space-y-3">
              {achievementItems.length === 0 && (
                <div className="text-center py-6">
                  <Inbox size={24} className="text-muted mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-muted">Nothing on record yet — add a certificate or project in Achievements.</p>
                </div>
              )}
              {achievementItems.slice(0, 3).map((a: any, i: number) => {
                const Icon = ACH_ICON[a.type] || Trophy;
                return (
                  <motion.div key={a.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08 }} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-gray-50 transition-colors">
                    <div className="w-9 h-9 rounded-lg bg-warning/10 flex items-center justify-center shrink-0"><Icon size={16} className="text-warning" /></div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{a.title}</div>
                      <div className="text-xs text-muted">{a.type}{a.won ? " · Won" : ""}{a.year ? ` · ${a.year}` : ""} · +{a.points} pts</div>
                    </div>
                  </motion.div>
                );
              })}
              {achievementItems.length > 0 && (
                <button onClick={() => setShowAchievements(true)} className="w-full text-xs font-semibold text-brand hover:underline pt-1">
                  View all {achievementItems.length} →
                </button>
              )}
            </div>
          </Card>
          <Card hover>
            <SectionTitle title="Quick Actions" />
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Update Profile", icon: UserPlus, href: "/student/profile" },
                { label: "Add Achievement", icon: Star, href: "/student/achievements" },
                { label: "Build Resume", icon: FileEdit, href: "/student/resume" },
                { label: "Ask AI", icon: MessageSquare, href: "/student/assistant" },
              ].map((q) => (
                <button key={q.label} onClick={() => router.push(q.href)} className="flex flex-col items-center gap-2 p-3 rounded-xl bg-gray-50 hover:bg-brand-light transition-colors group">
                  <q.icon size={18} className="text-muted group-hover:text-brand transition-colors" />
                  <span className="text-xs font-medium text-ink text-center">{q.label}</span>
                </button>
              ))}
            </div>
          </Card>
        </div>

        <AskAIBar onAsk={(q) => { push(`Got it — opening AI Assistant for: "${q.slice(0, 40)}"`, "info"); router.push(`/student/assistant?q=${encodeURIComponent(q)}`); }} />
      </div>

      {/* What the student has actually done — names, grouped by kind, with the
          points each one contributes to the Excellence Score. */}
      <CenterModal open={showAchievements} onClose={() => setShowAchievements(false)} title="My Achievements">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {ACH_GROUPS.slice(0, 2).map((g) => (
              <div key={g.type} className="bg-brand-light rounded-xl p-3 text-center">
                <div className="text-2xl font-extrabold text-brand numeric">{byType(g.type).length}</div>
                <div className="text-xs text-ink mt-0.5">{g.plural}</div>
              </div>
            ))}
          </div>

          {achievementItems.length === 0 ? (
            <div className="text-center py-8">
              <Inbox size={28} className="text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted">No certificates or projects on record yet.</p>
              <Button className="mt-4" onClick={() => router.push("/student/achievements")}>Add an Achievement</Button>
            </div>
          ) : (
            ACH_GROUPS.map((g) => {
              const rows = byType(g.type);
              if (rows.length === 0) return null;
              const Icon = ACH_ICON[g.type] || Trophy;
              return (
                <div key={g.type} className="border-t border-gray-100 pt-4 first:border-t-0 first:pt-0">
                  <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    {g.plural} ({rows.length})
                  </div>
                  <div className="space-y-2">
                    {rows.map((a: any) => (
                      <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-gray-50">
                        <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0 border border-gray-100">
                          <Icon size={14} className="text-brand" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-ink truncate">{a.title}</div>
                          {(a.detail || a.year || a.won) && (
                            <div className="text-xs text-muted truncate">
                              {[a.won ? "Won" : null, a.year, a.detail].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                        <span className={`text-xs font-semibold shrink-0 ${a.points > 0 ? "text-success" : "text-muted"}`}>
                          {a.points > 0 ? `+${a.points}` : "0"} pts
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}

          {achievementItems.length > 0 && (
            <div className="border-t border-gray-100 pt-4 flex items-center justify-between">
              <span className="text-sm font-semibold text-ink">Total Achievement Points</span>
              <span className="text-sm font-bold text-success numeric">
                +{achievementItems.reduce((sum: number, a: any) => sum + (a.points || 0), 0)}
              </span>
            </div>
          )}
        </div>
      </CenterModal>

      <CenterModal open={showAttendance} onClose={() => setShowAttendance(false)} title="Attendance by Subject">
        {!attendance || !attendance.subjects || attendance.subjects.length === 0 ? (
          <div className="text-center py-8">
            <CalendarCheck size={28} className="text-muted mx-auto mb-2 opacity-50" />
            <p className="text-sm text-muted">No attendance sessions have been recorded for you yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="bg-brand-light rounded-xl p-4 flex items-center justify-between">
              <div>
                <div className="text-xs text-muted">Overall Attendance</div>
                <div className="text-2xl font-extrabold text-brand numeric">{attendance.overall_pct ?? "N/A"}%</div>
              </div>
              <div className="text-xs text-muted text-right">{attendance.total_sessions_recorded} session{attendance.total_sessions_recorded === 1 ? "" : "s"} recorded<br />across {attendance.subjects.length} subject{attendance.subjects.length === 1 ? "" : "s"}</div>
            </div>
            <div className="space-y-2">
              {attendance.subjects.map((s: any) => {
                const pct = s.pct;
                const tone = pct == null ? "neutral" : pct >= 90 ? "success" : pct >= 75 ? "brand" : pct >= 60 ? "warning" : "danger";
                return (
                  <div key={s.code} className="flex items-center justify-between p-3 rounded-xl bg-gray-50">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink truncate">{s.code} — {s.name}</div>
                      <div className="text-xs text-muted">{s.attended} / {s.held} sessions attended</div>
                    </div>
                    <Badge tone={tone as any}>{pct != null ? `${pct}%` : "No data"}</Badge>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CenterModal>

      <CenterModal open={showBreakdown} onClose={() => setShowBreakdown(false)} title="Student Excellence Score">
        {excellence && (
          <div className="space-y-5">
            <div className="text-center">
              <div className="text-3xl font-extrabold font-display text-brand numeric">{excellence.total_score} Points</div>
              <div className="text-xs text-muted mt-1">This is also your Profile Score — the two are the same number.</div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">📚 Academic Performance</div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-ink">Current CGPA</span>
                <span className="font-semibold numeric">{excellence.cgpa.cgpa ?? "N/A"}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">{excellence.cgpa.reason}</span>
                <span className="font-semibold text-success">+{excellence.cgpa.cgpa_points}</span>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">🏅 Achievements</div>
              <p className="text-[11px] text-muted mb-2">Counted from your Achievements section — every certificate, hackathon and project on your record.</p>
              <div className="space-y-1.5 text-sm">
                <div className="flex items-center justify-between"><span className="text-ink">Certificates ({excellence.achievements.certificate_count} × 50)</span><span className="font-semibold text-success">+{excellence.achievements.certificate_points}</span></div>
                <div className="flex items-center justify-between"><span className="text-ink">Hackathons ({excellence.achievements.hackathon_count} × 50)</span><span className="font-semibold text-success">+{excellence.achievements.hackathon_points}</span></div>
                <div className="flex items-center justify-between"><span className="text-ink">Hackathon Wins ({excellence.achievements.hackathon_won_count} × 100)</span><span className="font-semibold text-success">+{excellence.achievements.hackathon_won_points}</span></div>
                <div className="flex items-center justify-between"><span className="text-ink">Projects ({excellence.achievements.project_count} × 100)</span><span className="font-semibold text-success">+{excellence.achievements.project_points}</span></div>
                {excellence.achievements.activity_count > 0 && (
                  <div className="flex items-center justify-between"><span className="text-ink">Activities ({excellence.achievements.activity_count} × 0)</span><span className="font-semibold text-muted">+0</span></div>
                )}
              </div>
              <div className="flex items-center justify-between text-sm font-semibold border-t border-dashed border-gray-200 mt-2 pt-2">
                <span>Total Achievement Points</span><span className="text-success">+{excellence.achievements.total_achievement_points}</span>
              </div>
              <button onClick={() => { setShowBreakdown(false); setShowAchievements(true); }} className="text-xs font-semibold text-brand hover:underline mt-2">
                See the {excellence.achievements.total_items} items counted →
              </button>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">CGPA Points + Achievement Points</span>
              </div>
              <div className="flex items-center justify-between font-bold text-ink mt-1">
                <span>Final Score</span>
                <span className="text-brand">{excellence.cgpa.cgpa_points} + {excellence.achievements.total_achievement_points} = {excellence.total_score}</span>
              </div>
            </div>

            <div className="border-t border-gray-100 pt-4">
              <div className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">💡 How You Can Improve</div>
              <div className="grid grid-cols-2 gap-2">
                {excellence.suggestions.map((s: any, i: number) => (
                  <div key={i} className="bg-brand-light rounded-xl p-3 text-center">
                    <div className="text-lg font-extrabold text-brand">+{s.points}</div>
                    <div className="text-xs text-ink mt-0.5">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </CenterModal>
    </>
  );
}
