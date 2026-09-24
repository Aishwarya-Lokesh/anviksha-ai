"use client";

import { motion, useMotionValue, animate } from "framer-motion";
import { useEffect, useState } from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  const mv = useMotionValue(0);

  useEffect(() => {
    const controls = animate(mv, value, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span className="numeric">
      {display.toFixed(decimals)}
      {suffix}
    </span>
  );
}

export function StatCard({
  label,
  value,
  suffix = "",
  decimals = 0,
  icon: Icon,
  tone = "brand",
  link,
  onClick,
  delay = 0,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  decimals?: number;
  icon: LucideIcon;
  tone?: "brand" | "success" | "warning" | "danger" | "info";
  link?: string;
  onClick?: () => void;
  delay?: number;
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand-light text-brand",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-[#9c6b12]",
    danger: "bg-danger/10 text-danger",
    info: "bg-info/10 text-info",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4 }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
      className={cn(
        "bg-white rounded-2xl border border-gray-100 shadow-card hover:shadow-cardHover p-5 transition-shadow duration-300",
        onClick && "cursor-pointer text-left focus:outline-none focus:ring-2 focus:ring-brand/40"
      )}
    >
      <div className="flex items-center justify-between mb-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", tones[tone])}>
          <Icon size={20} />
        </div>
      </div>
      <div className="text-3xl font-extrabold font-display text-ink">
        {typeof value === "number" && Number.isFinite(value)
          ? <CountUp value={value} decimals={decimals} suffix={suffix} />
          : <span className="text-xl">N/A</span>}
      </div>
      <div className="text-sm text-muted mt-1">{label}</div>
      {link && <div className="text-xs font-semibold text-brand mt-2 cursor-pointer hover:underline">{link}</div>}
    </motion.div>
  );
}
