"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { Card } from "@/components/ui/Primitives";

export function AIInsightCard({ fetcher }: { fetcher: () => Promise<{ insight: string | null; connected: boolean }> }) {
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "error">("loading");
  const [insight, setInsight] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    fetcher()
      .then((res) => {
        if (cancelled) return;
        if (res.connected && res.insight) {
          setInsight(res.insight);
          setState("ready");
        } else {
          setState("unavailable");
        }
      })
      .catch(() => { if (!cancelled) setState("error"); });
    return () => { cancelled = true; };
  }, [fetcher]);

  if (state === "loading") {
    return (
      <Card className="!p-4 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-brand-light flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-brand animate-pulse" />
        </div>
        <div className="h-3 w-2/3 bg-gray-100 rounded animate-pulse" />
      </Card>
    );
  }

  if (state === "unavailable" || state === "error") {
    return (
      <Card className="!p-4 flex items-center gap-3 text-xs text-muted">
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-gray-400" />
        </div>
        <span>AI insight isn't connected yet — ask an administrator to check the backend AI configuration.</span>
      </Card>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <Card className="!p-4 flex gap-3 bg-gradient-to-br from-brand-light/60 to-white border-brand/10">
        <div className="w-8 h-8 rounded-full bg-brand flex items-center justify-center shrink-0">
          <Sparkles size={16} className="text-white" />
        </div>
        <div>
          <div className="text-xs font-semibold text-brand mb-1">AI Insight</div>
          <p className="text-sm text-ink leading-relaxed">{insight}</p>
        </div>
      </Card>
    </motion.div>
  );
}
