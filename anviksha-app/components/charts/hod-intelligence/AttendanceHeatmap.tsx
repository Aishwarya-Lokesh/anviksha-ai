"use client";

import { motion } from "framer-motion";
import { SEVERITY_BG, SEVERITY_TEXT, Severity } from "./severity";

export interface HeatmapCell {
  section: string;
  pct: number | null;
  status: "available" | "pending";
  display: string;
  present: number | null;
  absent: number | null;
  total: number | null;
  severity: Severity;
}

export interface HeatmapRow {
  semester: number;
  subject_code: string;
  subject_name: string;
  cells: HeatmapCell[];
}

/**
 * Today's Section x Subject attendance heatmap. Recharts has no native
 * heatmap primitive, so — same convention already used elsewhere in this
 * app for grid-style data (e.g. plain HTML tables in modals) — this is a
 * real CSS-grid table with severity-coloured cells, not a new charting
 * library. Scrolls inside its own container so a wide subject list never
 * overflows the page (Part D6).
 */
export function AttendanceHeatmap({ sections, rows }: { sections: string[]; rows: HeatmapRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted text-center py-8">No attendance records available.</p>;
  }
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-xs border-separate" style={{ borderSpacing: "4px" }}>
        <thead>
          <tr>
            <th className="text-left font-medium text-muted pb-1 pl-1 sticky left-0 bg-white">Subject</th>
            {sections.map((sec) => (
              <th key={sec} className="text-center font-medium text-muted pb-1 min-w-[92px]">{sec}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.subject_code}-${row.semester}`}>
              <td className="pr-3 py-1 whitespace-nowrap sticky left-0 bg-white">
                <div className="font-medium text-ink">{row.subject_code}</div>
                <div className="text-[10px] text-muted">Sem {row.semester}</div>
              </td>
              {row.cells.map((cell, j) => (
                <td key={j} className="p-0">
                  <motion.div
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25, delay: Math.min((i * row.cells.length + j) * 0.01, 0.4) }}
                    title={
                      cell.status === "available"
                        ? `${row.subject_code} — ${cell.section}: ${cell.present}/${cell.total} present (${cell.pct}%)`
                        : `${row.subject_code} — ${cell.section}: no attendance submitted today`
                    }
                    className={`rounded-lg py-2.5 text-center font-semibold ${SEVERITY_BG[cell.severity]} ${SEVERITY_TEXT[cell.severity]}`}
                  >
                    {cell.status === "available" ? `${cell.pct}%` : "Pending"}
                  </motion.div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
