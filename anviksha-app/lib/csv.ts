"use client";

function cell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Saves rows as a .csv file that opens cleanly in Excel. */
export function downloadCsv(filename: string, headers: string[], rows: unknown[][]) {
  const text = [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  // The leading mark tells Excel the file is UTF-8, so names with accents survive.
  const blob = new Blob(["﻿", text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
