"use client";

import { motion } from "framer-motion";

export function DashboardSkeleton() {
  return (
    <div className="p-4 md:p-8 space-y-6 animate-pulse">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-gray-100 h-28 p-5">
            <div className="w-10 h-10 rounded-xl bg-gray-100 mb-3" />
            <div className="h-6 w-16 bg-gray-100 rounded mb-2" />
            <div className="h-3 w-20 bg-gray-100 rounded" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 h-64" />
        <div className="bg-white rounded-2xl border border-gray-100 h-64" />
      </div>
    </div>
  );
}

export function InlineSpinner({ label = "Loading your real data..." }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }}
        className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full"
      />
      {label}
    </div>
  );
}
