"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";
import { LoadError, EmptyState } from "@/components/ui/States";
import { api } from "@/lib/api";

const toneFor: Record<string, "warning" | "info" | "success" | "danger"> = {
  Pending: "warning", Collectable: "info", Collected: "success", Rejected: "danger",
};

export default function AdminDocumentsPage() {
  const [requests, setRequests] = useState<any[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const { push } = useToast();

  const load = () => {
    setLoadError(false);
    api.adminDocuments()
      .then((rows) => setRequests(rows.map((r: any) => ({ ...r, name: r.student_name, date: r.requested_date }))))
      .catch(() => setLoadError(true));
  };
  useEffect(load, []);

  const update = async (id: number, status: string) => {
    try {
      await api.adminDocumentUpdate(id, status);
      setRequests((requests || []).map((r) => (r.id === id ? { ...r, status } : r)));
      push(status === "Rejected" ? "Request rejected" : "Request approved — marked ready to collect");
    } catch {
      push("Could not update the request. Please try again.", "error");
    }
  };

  return (
    <>
      <Topbar greeting="Document Requests" subtitle="Dashboard > Document Requests" avatarLetter="A" />
      <div className="p-4 md:p-8 space-y-6">
        <Card hover>
          <SectionTitle title="Institute-wide Requests" />
          {loadError ? <LoadError message="We couldn't load document requests." onRetry={load} /> : requests === null ? (
            <p className="text-sm text-muted text-center py-10">Loading requests…</p>
          ) : requests.length === 0 ? (
            <EmptyState title="No document requests yet" hint="Requests students raise from their Document Requests page appear here." />
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead>
                <tr className="text-left text-muted border-b border-gray-100">
                  <th className="py-2.5 font-medium">Student</th><th className="py-2.5 font-medium">Document Type</th><th className="py-2.5 font-medium">Requested On</th>
                  <th className="py-2.5 font-medium">Status</th><th className="py-2.5 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r) => (
                  <motion.tr key={r.id} layout className="border-b border-gray-50 hover:bg-gray-50/70 transition-colors">
                    <td className="py-3 font-medium text-ink">{r.name}</td>
                    <td className="py-3 text-muted">{r.type}</td>
                    <td className="py-3 text-muted">{r.date}</td>
                    <td className="py-3"><Badge tone={toneFor[r.status] || "neutral"}>{r.status}</Badge></td>
                    <td className="py-3">
                      {r.status === "Pending" ? (
                        <div className="flex gap-2">
                          <button onClick={() => update(r.id, "Collectable")} aria-label="Approve request" title="Approve" className="p-2.5 rounded-lg hover:bg-success/10 text-success"><Check size={15} /></button>
                          <button onClick={() => update(r.id, "Rejected")} aria-label="Reject request" title="Reject" className="p-2.5 rounded-lg hover:bg-danger/10 text-danger"><X size={15} /></button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </td>
                  </motion.tr>
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
