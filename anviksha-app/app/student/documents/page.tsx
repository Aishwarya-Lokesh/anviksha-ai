"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge, Button } from "@/components/ui/Primitives";
import { CenterModal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { Plus, Clock, PackageCheck, CheckCircle2, XCircle, Inbox } from "lucide-react";
import { LoadError, EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api";

const toneFor: Record<string, "warning" | "info" | "success" | "danger"> = {
  Pending: "warning", Collectable: "info", Collected: "success", Rejected: "danger",
};

export default function DocumentsPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("Bonafide Certificate");
  const [purpose, setPurpose] = useState("");
  const { push } = useToast();

  const load = () => {
    setLoadError(false);
    api.studentDocuments().then((rows) => { setRequests(rows); setLoaded(true); }).catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const counts = {
    Pending: requests.filter((r) => r.status === "Pending").length,
    Collectable: requests.filter((r) => r.status === "Collectable").length,
    Collected: requests.filter((r) => r.status === "Collected").length,
    Rejected: requests.filter((r) => r.status === "Rejected").length,
  };

  const submit = async () => {
    if (!purpose) return;
    try {
      await api.requestDocument({ type, purpose });
      push("Request submitted");
      setOpen(false);
      setPurpose("");
      load();
    } catch {
      push("Could not submit your request. Please try again.", "error");
    }
  };

  const stat = [
    { label: "Pending", value: counts.Pending, icon: Clock, tone: "warning" as const },
    { label: "Collectable", value: counts.Collectable, icon: PackageCheck, tone: "info" as const },
    { label: "Collected", value: counts.Collected, icon: CheckCircle2, tone: "success" as const },
    { label: "Rejected", value: counts.Rejected, icon: XCircle, tone: "danger" as const },
  ];

  return (
    <>
      <Topbar greeting="Document Requests" subtitle="Dashboard > Document Requests" avatarLetter="S" />
      <div className="p-4 md:p-8 space-y-6">
        <div className="flex justify-end">
          <Button onClick={() => setOpen(true)}><Plus size={15} /> New Request</Button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {stat.map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
              <Card hover className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-${s.tone}/10`} style={{ background: "rgba(0,0,0,0.04)" }}>
                  <s.icon size={19} />
                </div>
                <div>
                  <div className="text-2xl font-extrabold font-display text-ink numeric">{s.value}</div>
                  <div className="text-xs text-muted">{s.label}</div>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>

        <Card hover>
          <SectionTitle title="My Requests" />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-gray-100">
                  <th className="py-2.5 font-medium">Document Type</th>
                  <th className="py-2.5 font-medium">Purpose</th>
                  <th className="py-2.5 font-medium">Requested On</th>
                  <th className="py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <motion.tr key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                    <td className="py-3 font-medium text-ink">{r.type}</td>
                    <td className="py-3 text-muted">{r.purpose}</td>
                    <td className="py-3 text-muted">{r.date}</td>
                    <td className="py-3"><Badge tone={toneFor[r.status]}>{r.status}</Badge></td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <CenterModal open={open} onClose={() => setOpen(false)} title="New Document Request">
        <div className="space-y-4">
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Document Type</label>
            <select value={type} onChange={(e) => setType(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30">
              {["Bonafide Certificate", "Transcript", "Study Certificate", "Conduct Certificate", "Grade Card", "Migration Certificate"].map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-medium text-muted mb-1 block">Purpose</label>
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Higher Studies" className="w-full border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand/30" />
          </div>
          <Button className="w-full" onClick={submit}>Submit Request</Button>
        </div>
      </CenterModal>
    </>
  );
}
