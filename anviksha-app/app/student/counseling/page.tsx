"use client";

import { useEffect, useState } from "react";
import { Topbar } from "@/components/layout/Topbar";
import { Card, SectionTitle, Button, Badge } from "@/components/ui/Primitives";
import { useToast } from "@/components/ui/Toaster";
import { motion } from "framer-motion";
import { HeartHandshake, MessageCircle, Inbox, Pencil, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { DashboardSkeleton } from "@/components/ui/Skeleton";

const REPLY_OPTIONS = ["Completed", "Pending", "Done", "Following"];
const REPLY_TONE: Record<string, "success" | "warning" | "info" | "brand"> = {
  Completed: "success", Done: "success", Pending: "warning", Following: "info",
};

export default function CounselingPage() {
  const [data, setData] = useState<any>(null);
  const [liveMode, setLiveMode] = useState(false);
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [status, setStatus] = useState("Pending");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const { push } = useToast();

  const load = () => api.myCounseling().then((d) => { setData(d); setLiveMode(true); }).catch(() => setData({ mentor: null, notes: [] }));
  useEffect(() => { load(); }, []);

  if (!data) return <><Topbar greeting="Counseling" subtitle="Loading..." avatarLetter="S" /><DashboardSkeleton /></>;

  const openReply = (n: any) => {
    setReplyingTo(n.id);
    setStatus(n.reply_status || "Pending");
    setDescription(n.reply_description || "");
  };

  const saveReply = async () => {
    if (replyingTo == null) return;
    setSaving(true);
    try {
      await api.studentReplyCounseling(replyingTo, status, description || undefined);
      push("Reply saved");
      setReplyingTo(null);
      load();
    } catch (e: any) {
      push(e.message || "Failed to save reply", "error");
    }
    setSaving(false);
  };

  const deleteReply = async (noteId: number) => {
    try {
      await api.studentDeleteCounselingReply(noteId);
      push("Reply removed");
      load();
    } catch {
      push("Failed to remove reply", "error");
    }
  };

  return (
    <>
      <Topbar greeting="Counseling" subtitle="Dashboard > Counseling" avatarLetter="S" />
      <div className="px-8 pt-4">
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${liveMode ? "bg-success/10 text-success" : "bg-warning/10 text-[#9c6b12]"}`}>
          {liveMode ? "● Live — real notes from your real mentor" : "○ Backend not connected"}
        </span>
      </div>
      <div className="p-8 grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1 text-center" hover>
          <div className="w-16 h-16 rounded-full bg-brand-light flex items-center justify-center mx-auto mb-3">
            <HeartHandshake size={28} className="text-brand" />
          </div>
          {data.mentor ? (
            <>
              <h3 className="font-semibold text-ink">{data.mentor.name}</h3>
              <p className="text-sm text-muted mt-1">{data.mentor.designation}</p>
            </>
          ) : (
            <p className="text-sm text-muted">No mentor has logged a counseling note for you yet</p>
          )}
        </Card>

        <Card className="lg:col-span-2" hover>
          <SectionTitle title="Counseling Notes" subtitle="Reply with a status so your mentor knows where things stand" />
          {data.notes.length === 0 ? (
            <div className="text-center py-10">
              <Inbox size={28} className="text-muted mx-auto mb-2 opacity-50" />
              <p className="text-sm text-muted">No counseling notes yet.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {data.notes.map((n: any, i: number) => (
                <motion.div key={n.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }} className="p-4 rounded-xl bg-gray-50">
                  <div className="flex gap-3">
                    <MessageCircle size={16} className="text-brand mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted mb-1">{n.date}{n.teacher_name ? ` · ${n.teacher_name}` : ""}</div>
                      <div className="text-sm text-ink leading-relaxed">{n.note}</div>
                    </div>
                  </div>

                  {n.teacher_reply && (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                      <div className="text-[10px] text-muted mb-1">{n.teacher_name || "Your mentor"} replied · {n.teacher_replied_at?.slice(0, 10)}</div>
                      <p className="text-sm text-ink italic">{n.teacher_reply}</p>
                    </div>
                  )}

                  {replyingTo === n.id ? (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200 space-y-2.5">
                      <div className="flex flex-wrap gap-1.5">
                        {REPLY_OPTIONS.map((opt) => (
                          <button key={opt} onClick={() => setStatus(opt)} className={`text-xs font-semibold px-3 py-1.5 rounded-full transition-colors ${status === opt ? "bg-brand text-white" : "bg-white text-muted border border-gray-200"}`}>
                            {opt}
                          </button>
                        ))}
                      </div>
                      <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Additional details (optional)" className="w-full border border-gray-200 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-brand/30" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setReplyingTo(null)}>Cancel</Button>
                        <Button size="sm" onClick={saveReply} disabled={saving}>{saving ? "Saving..." : "Save Reply"}</Button>
                      </div>
                    </div>
                  ) : n.reply_status ? (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge tone={REPLY_TONE[n.reply_status] || "brand"}>{n.reply_status}</Badge>
                          <span className="text-[10px] text-muted">replied {n.replied_at?.slice(0, 10)}</span>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => openReply(n)} className="text-muted hover:text-brand p-1.5 rounded-lg hover:bg-white"><Pencil size={13} /></button>
                          <button onClick={() => deleteReply(n.id)} className="text-muted hover:text-danger p-1.5 rounded-lg hover:bg-white"><Trash2 size={13} /></button>
                        </div>
                      </div>
                      {n.reply_description && <p className="text-xs text-ink mt-1.5">{n.reply_description}</p>}
                    </div>
                  ) : (
                    <div className="mt-3 pt-3 border-t border-dashed border-gray-200">
                      <Button size="sm" variant="secondary" onClick={() => openReply(n)}>Reply</Button>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
