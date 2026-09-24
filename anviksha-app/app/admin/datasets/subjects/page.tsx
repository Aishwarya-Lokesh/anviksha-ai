"use client";

import { useEffect, useMemo, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, Button, Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { Search, Upload } from "lucide-react";
import { api } from "@/lib/api";
import subjectsMock from "@/data/subjects.json";

export default function SubjectDatasetPage() {
  const [query, setQuery] = useState("");
  const { push } = useToast();
  const [subjects, setSubjects] = useState<any[]>(subjectsMock);
  const [liveMode, setLiveMode] = useState(false);

  useEffect(() => {
    api.adminSubjects()
      .then((rows) => { setSubjects(rows); setLiveMode(true); })
      .catch(() => setLiveMode(false));
  }, []);

  const filtered = useMemo(() => subjects.filter((s: any) =>
    (s.name || "").toLowerCase().includes(query.toLowerCase()) || (s.code || "").toLowerCase().includes(query.toLowerCase())
  ), [query, subjects]);

  return (
    <>
      <Topbar greeting="Subject Dataset" subtitle="Dashboard > Subject Dataset" avatarLetter="A" />
      <div className="px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Live data from backend" : "○ Mock data (backend not connected)"}
        </span>
      </div>
      <div className="p-8 space-y-6">
        <Card hover>
          <div className="flex items-center justify-between flex-wrap gap-3 mb-5">
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subjects..." className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl outline-none w-64" />
            </div>
            <Button variant="secondary" onClick={() => push("Excel file imported (demo)", "info")}><Upload size={15} /> Import Excel</Button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-gray-100">
                <th className="py-2.5 font-medium">Code</th><th className="py-2.5 font-medium">Name</th><th className="py-2.5 font-medium">Semester</th>
                {liveMode && <th className="py-2.5 font-medium">Name Confirmed?</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s: any) => (
                <tr key={s.code} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                  <td className="py-3 font-medium text-ink">{s.code}</td>
                  <td className="py-3 text-ink">{s.name}</td>
                  <td className="py-3 text-muted">{s.semester}</td>
                  {liveMode && <td className="py-3">{s.name_verified ? <Badge tone="success">Confirmed</Badge> : <Badge tone="warning">Verify</Badge>}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
