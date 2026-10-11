"use client";

import { AlertTriangle, Inbox, RefreshCw } from "lucide-react";
import { LucideIcon } from "lucide-react";

/** Shown when a page's data could not be loaded. Never replaced by sample data. */
export function LoadError({
  message = "We couldn't load this right now.",
  onRetry,
  compact = false,
}: {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}) {
  return (
    <div role="alert" className={`text-center ${compact ? "py-6" : "py-12 px-4"}`}>
      <div className="w-11 h-11 rounded-2xl bg-danger/10 flex items-center justify-center mx-auto mb-3">
        <AlertTriangle size={20} className="text-danger" />
      </div>
      <p className="text-sm font-medium text-ink">{message}</p>
      <p className="text-xs text-muted mt-1">Check your connection and try again.</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-brand text-white text-sm font-semibold hover:bg-brand-dark transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2"
        >
          <RefreshCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

/** Shown when a section loaded fine but has nothing in it yet. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  hint,
  action,
  compact = false,
}: {
  icon?: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`text-center ${compact ? "py-6" : "py-10 px-4"}`}>
      <div className="w-11 h-11 rounded-2xl bg-brand-light flex items-center justify-center mx-auto mb-3">
        <Icon size={20} className="text-brand" />
      </div>
      <p className="text-sm font-medium text-ink">{title}</p>
      {hint && <p className="text-xs text-muted mt-1 max-w-sm mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
