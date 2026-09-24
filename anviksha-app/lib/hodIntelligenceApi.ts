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

  facultyOverview: () => requestJson("/hod/intelligence/faculty/overview"),
  facultyTable: (search?: string) => requestJson(`/hod/intelligence/faculty${search ? `?search=${encodeURIComponent(search)}` : ""}`),
  facultyDetail: (facultyId: number) => requestJson(`/hod/intelligence/faculty/${facultyId}`),
  alerts: () => requestJson("/hod/intelligence/alerts"),

  healthSnapshot: () => requestJson("/hod/intelligence/health-snapshot"),
  atRiskDetail: () => requestJson("/hod/intelligence/at-risk-detail"),
  pendingDocuments: () => requestJson("/hod/intelligence/pending-documents"),

  passRateOutliers: () => requestJson("/hod/intelligence/assessment/pass-rate-outliers"),
  bloomCoverage: () => requestJson("/hod/intelligence/assessment/bloom-coverage"),
  sectionComparison: (subjectId: number) => requestJson(`/hod/intelligence/assessment/section-comparison?subject_id=${subjectId}`),

  placementFunnel: (passedOutYear?: number) => requestJson(`/hod/intelligence/placement/funnel${passedOutYear ? `?passed_out_year=${passedOutYear}` : ""}`),
  placementTiers: (passedOutYear?: number) => requestJson(`/hod/intelligence/placement/tiers${passedOutYear ? `?passed_out_year=${passedOutYear}` : ""}`),
  placementCycleComparison: () => requestJson("/hod/intelligence/placement/cycle-comparison"),
};
