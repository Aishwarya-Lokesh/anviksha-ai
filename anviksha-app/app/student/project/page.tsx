"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileText, Plus } from "lucide-react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { DashboardSkeleton } from "@/components/ui/Skeleton";
import { EmptyState, LoadError } from "@/components/ui/States";
import { useToast } from "@/components/ui/Toaster";
import { api } from "@/lib/api";
import { INPUT } from "@/components/projects/shared";
import { ProjectWorkspace } from "@/components/projects/ProjectWorkspace";

type Row = { id: number; title: string; project_type: string | null; versions: number; updated: string | null };

export default function ProjectPage() {
  const router = useRouter();
  const pathname = usePathname();
  const id = Number(useSearchParams().get("id")) || null;
  const { push } = useToast();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState("Final year project");
  const [types, setTypes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setFailed(false);
    api.myProjects().then(setRows).catch(() => setFailed(true));
  };
  useEffect(() => {
    if (id) return;
    load();
    api.projectStart().then((s) => setTypes(s.project_types || [])).catch(() => {});
  }, [id]);

  const create = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const made = await api.createProject({ title, details: { project_type: type } });
      setCreating(false);
      setTitle("");
      router.push(`${pathname}?id=${made.id}`);
    } catch (e: any) {
      push(e?.detail || "Could not create the project.", "error");
    }
    setBusy(false);
  };

  const heading = "Project Report & PPT";
  if (id) return <><Topbar greeting={heading} subtitle="Dashboard > Project Report & PPT" avatarLetter="S" /><ProjectWorkspace id={id} /></>;
  if (failed) return <><Topbar greeting={heading} subtitle="In your college's format" avatarLetter="S" /><LoadError message="We couldn't load your projects." onRetry={load} /></>;
  if (!rows) return <><Topbar greeting={heading} subtitle="Loading…" avatarLetter="S" /><DashboardSkeleton /></>;

  return (
    <>
      <Topbar greeting={heading} subtitle="Dashboard > Project Report & PPT" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-5 max-w-4xl">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <p className="text-sm text-muted max-w-xl">
            Give your project's details and your own material. You get the report and the presentation in the official format,
            as Word, PowerPoint and PDF, ready to review and edit.
          </p>
          <Button className="min-h-[44px]" onClick={() => setCreating(true)}><Plus size={15} /> New project</Button>
        </div>
        <Card className="!p-0 overflow-hidden">
          <div className="px-5 pt-5"><SectionTitle title="My projects" /></div>
          {rows.length === 0 ? (
            <EmptyState icon={FileText} title="No project yet" hint="Start one for your mini project or final year project. Only you can see it until you share it with your guide." action={<Button className="min-h-[44px]" onClick={() => setCreating(true)}><Plus size={15} /> Start a project</Button>} />
          ) : (
            <ul className="divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id}>
                  <button onClick={() => router.push(`${pathname}?id=${r.id}`)} className="w-full flex items-center gap-3 px-5 py-3 min-h-[60px] text-left hover:bg-gray-50 outline-none focus-visible:ring-2 focus-visible:ring-brand/40">
                    <div className="w-10 h-10 rounded-xl bg-brand-light flex items-center justify-center shrink-0"><FileText size={18} className="text-brand" /></div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-ink break-words">{r.title}</div>
                      <div className="text-xs text-muted">{[r.project_type, r.updated ? `Updated ${r.updated}` : null].filter(Boolean).join(" · ")}</div>
                    </div>
                    <Badge tone={r.versions ? "success" : "neutral"}>{r.versions ? `${r.versions} version${r.versions === 1 ? "" : "s"}` : "Not built yet"}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <CenterModal open={creating} onClose={() => !busy && setCreating(false)} title="New project">
        <div className="space-y-3">
          <div>
            <label htmlFor="np-title" className="text-xs font-medium text-muted mb-1 block">Project title</label>
            <input id="np-title" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Smart Attendance System Using Face Recognition" className={INPUT} />
          </div>
          <div>
            <label htmlFor="np-type" className="text-xs font-medium text-muted mb-1 block">Project type</label>
            <select id="np-type" value={type} onChange={(e) => setType(e.target.value)} className={INPUT}>
              {(types.length ? types : [type]).map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Button className="w-full min-h-[44px]" disabled={busy || title.trim().length < 5} onClick={create}>{busy ? "Creating…" : "Create and continue"}</Button>
        </div>
      </CenterModal>
    </>
  );
}
