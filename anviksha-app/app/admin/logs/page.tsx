"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle } from "@/components/ui/Primitives";
import { motion } from "framer-motion";
import { Activity, Inbox } from "lucide-react";
import { LoadError, EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api";

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [userFilter, setUserFilter] = useState("All");

  const load = () => {
    setLoadError(false);
    api.adminActivityLogs().then((rows) => { setLogs(rows); setLoaded(true); }).catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const users = useMemo(() => ["All", ...Array.from(new Set(logs.map((l: any) => l.user)))], [logs]);
  const filtered = useMemo(() => userFilter === "All" ? logs : logs.filter((l: any) => l.user === userFilter), [userFilter, logs]);

  return (
    <>
      <Topbar greeting="Activity Logs" subtitle="Dashboard > Activity Logs" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <div className="flex items-center justify-between mb-4">
            <SectionTitle title="System Activity" subtitle="The 100 most recent recorded actions" />
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="border border-gray-200 rounded-xl px-3 py-2 text-sm outline-none">
              {users.map((u) => <option key={u}>{u}</option>)}
            </select>
          </div>
          {loadError ? <LoadError message="We couldn't load the activity log." onRetry={load} /> : !loaded ? (
            <p className="text-sm text-muted text-center py-10">Loading activity…</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-10">
              <Inbox size={28} className="text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted">No activity recorded yet — actions like adding a student, marking attendance, or approving a document will appear here.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filtered.map((log: any, i: number) => (
                <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i * 0.03, 0.3) }} className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-brand-light flex items-center justify-center shrink-0 mt-0.5"><Activity size={14} className="text-brand" /></div>
                  <div>
                    <div className="text-sm text-ink"><span className="font-semibold">{log.user}</span> — {log.action}</div>
                    <div className="text-xs text-muted">{log.time}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
