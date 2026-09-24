"use client";

import { motion } from "framer-motion";

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: string[];
  active: string;
  onChange: (t: string) => void;
}) {
  return (
    <div className="flex gap-1 border-b border-gray-100 relative">
      {tabs.map((tab) => (
        <button
          key={tab}
          onClick={() => onChange(tab)}
          className="relative px-4 py-2.5 text-sm font-medium transition-colors"
          style={{ color: active === tab ? "#5B3FD9" : "#6B7280" }}
        >
          {tab}
          {active === tab && (
            <motion.div
              layoutId="tab-underline"
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand rounded-full"
              transition={{ type: "spring", stiffness: 400, damping: 32 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}

export function PillNav({
  items,
  active,
  onChange,
}: {
  items: { key: string; label: string }[];
  active: string;
  onChange: (k: string) => void;
}) {
  return (
    <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit relative">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className="relative px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors z-10"
          style={{ color: active === it.key ? "#fff" : "#6B7280" }}
        >
          {active === it.key && (
            <motion.div
              layoutId="pill-bg"
              className="absolute inset-0 bg-brand rounded-lg -z-10"
              transition={{ type: "spring", stiffness: 400, damping: 30 }}
            />
          )}
          {it.label}
        </button>
      ))}
    </div>
  );
}
