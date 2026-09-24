// Part D3 — one semantic severity->color map, shared by every new HOD
// Department Intelligence chart/table, aligned to the app's existing theme
// tokens (tailwind.config.ts: success/warning/danger). The backend is the
// single source of truth for WHICH severity a value gets (see
// app/core/hod_metrics.py::attendance_severity) — this module only maps
// that already-decided severity string to a colour.
export type Severity = "green" | "amber" | "red" | "neutral";

export const SEVERITY_HEX: Record<Severity, string> = {
  green: "#1F9D55",   // matches tailwind `success`
  amber: "#E8A93B",   // matches tailwind `warning`
  red: "#E5484D",     // matches tailwind `danger`
  neutral: "#D1D5DB", // gray-300 — pending / unavailable / insufficient data
};

export const SEVERITY_BG: Record<Severity, string> = {
  green: "bg-success/15",
  amber: "bg-warning/20",
  red: "bg-danger/15",
  neutral: "bg-gray-100",
};

export const SEVERITY_TEXT: Record<Severity, string> = {
  green: "text-success",
  amber: "text-[#9c6b12]",
  red: "text-danger",
  neutral: "text-muted",
};

export const SEVERITY_BADGE_TONE: Record<Severity, "success" | "warning" | "danger" | "neutral"> = {
  green: "success",
  amber: "warning",
  red: "danger",
  neutral: "neutral",
};
