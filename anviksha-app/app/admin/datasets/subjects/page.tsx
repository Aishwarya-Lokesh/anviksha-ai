"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Button, Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { Search, Upload } from "lucide-react";
import { api } from "@/lib/api";
import { LoadError, EmptyState } from "@/components/ui/States";

export default function SubjectDatasetPage() {
  const [query, setQuery] = useState("");
  const { push } = useToast();
  const [subjects, setSubjects] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = () => {
    setLoadError(false);
    api.adminSubjects().then(setSubjects).catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const filtered = useMemo(() => (subjects || []).filter((s: any) =>
    (s.name || "").toLowerCase().includes(query.toLowerCase()) || (s.code || "").toLowerCase().includes(query.toLowerCase())
  ), [query, subjects]);

  return (
    <>
      <Topbar greeting="Subject Dataset" subtitle="Dashboard > Subject Dataset" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subjects..." className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl outline-none w-64" />
            </div>
          </div>
          {loadError ? <LoadError message="We couldn't load the subject list." onRetry={load} /> : subjects === null ? (
            <p className="text-sm text-muted text-center py-10">Loading subjects…</p>
          ) : filtered.length === 0 ? (
            <EmptyState title={query ? "No subjects match your search" : "No subjects on record yet"} />
          ) : (
          <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="text-left text-muted border-b border-gray-100">
                <th className="py-2.5 font-medium">Code</th><th className="py-2.5 font-medium">Name</th><th className="py-2.5 font-medium">Semester</th>
                <th className="py-2.5 font-medium">Name Confirmed?</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: any) => (
                <tr key={s.code} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                  <td className="py-3 font-medium text-ink">{s.code}</td>
                  <td className="py-3 text-ink">{s.name}</td>
                  <td className="py-3 text-muted">{s.semester}</td>
                  <td className="py-3">{s.name_verified ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Verify</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          )}
        </Card>
      </div>
    </>
  );
}
