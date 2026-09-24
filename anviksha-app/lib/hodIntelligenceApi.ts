"use client";

// HOD Department Intelligence — add-on API client, kept deliberately separate
// from lib/api.ts (Part A9: additions to existing files should be minimal;
// this whole feature can be removed by deleting this file + its callers).
import { API_BASE, getToken } from "@/lib/api";

async function requestJson(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error(`Unable to connect to backend at ${API_BASE}. Make sure the FastAPI backend is running.`);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${body}`);
  }
  return res.json();
}

export const hodIntelligenceApi = {
  attendanceToday: () => requestJson("/hod/intelligence/attendance/today"),
  attendanceTrend: (days: number = 14) => requestJson(`/hod/intelligence/attendance/trend?days=${days}`),
};
