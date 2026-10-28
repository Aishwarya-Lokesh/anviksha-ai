"use client";

// Use the IPv4 loopback address by default in LOCAL DEVELOPMENT only. On
// some Windows/Chrome setups `localhost` resolves to IPv6 (`::1`) first,
// while the local FastAPI server is listening on IPv4 only, causing
// otherwise healthy API calls to fail. In production, a missing
// NEXT_PUBLIC_API_BASE must never silently fall back to a loopback address
// (every visitor's own browser would try to reach 127.0.0.1 and every
// feature would fail with no obvious cause) — it fails loudly instead.
const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE;
const isLocalValue = configuredApiBase === "http://localhost:8000" || configuredApiBase === "http://127.0.0.1:8000";

if (!configuredApiBase && process.env.NODE_ENV === "production") {
  throw new Error(
    "NEXT_PUBLIC_API_BASE is not set. In production this must point at the real deployed backend URL — it will never fall back to a local address."
  );
}

export const API_BASE = !configuredApiBase || isLocalValue ? "http://127.0.0.1:8000" : configuredApiBase;

const TOKEN_KEY = "anviksha_access_token";
const ROLE_KEY = "anviksha_role";
let inMemoryToken: string | null = null;
let inMemoryRole: string | null = null;

function storage() {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function hydrateAuth() {
  const session = storage();
  if (session && !inMemoryToken) {
    inMemoryToken = session.getItem(TOKEN_KEY);
    inMemoryRole = session.getItem(ROLE_KEY);
  }
}

const JUST_LOGGED_IN_KEY = "anviksha_just_logged_in";

export function setAuth(token: string, role: string) {
  inMemoryToken = token;
  inMemoryRole = role;
  storage()?.setItem(TOKEN_KEY, token);
  storage()?.setItem(ROLE_KEY, role);
  // Marks this as a fresh login (not a page refresh/navigation) so the
  // dashboard can react to it exactly once — e.g. the CGPA celebration.
  storage()?.setItem(JUST_LOGGED_IN_KEY, "1");
}

// Returns true only once per login — the flag is consumed on first read.
export function consumeJustLoggedIn(): boolean {
  const s = storage();
  if (!s) return false;
  const flag = s.getItem(JUST_LOGGED_IN_KEY);
  if (flag) s.removeItem(JUST_LOGGED_IN_KEY);
  return !!flag;
}

export function getRole() {
  hydrateAuth();
  return inMemoryRole;
}

export function isAuthenticated() {
  hydrateAuth();
  return !!inMemoryToken;
}

export function getToken() {
  hydrateAuth();
  return inMemoryToken;
}

export function clearAuth() {
  inMemoryToken = null;
  inMemoryRole = null;
  storage()?.removeItem(TOKEN_KEY);
  storage()?.removeItem(ROLE_KEY);
}

// The backend host puts the server to sleep when idle; the first request
// afterwards can take up to a minute and may briefly answer 502/503/504 while
// it starts. Safe requests are retried through that window instead of failing.
const WAKE_STATUSES = new Set([502, 503, 504]);
const WAKE_WINDOW_MS = 90_000;
export const SERVER_WAKING_EVENT = "anviksha:server-waking";

function announceWaking(waking: boolean) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SERVER_WAKING_EVENT, { detail: waking }));
  }
}

// Called as soon as the home or sign-in page opens: if the server has gone
// to sleep it starts waking now, while the visitor is still choosing a role
// and typing, instead of when they press "Sign In".
let wakeSent = false;
export function wakeServer() {
  if (wakeSent || typeof window === "undefined") return;
  wakeSent = true;
  fetch(`${API_BASE}/health`, { cache: "no-store" }).catch(() => { wakeSent = false; });
}

async function fetchWithWake(url: string, init: RequestInit, retryable: boolean): Promise<Response> {
  const deadline = Date.now() + WAKE_WINDOW_MS;
  // A healthy server answers well inside this; past it, tell the UI we're waiting.
  const slowTimer = setTimeout(() => announceWaking(true), 4000);
  let attempt = 0;
  try {
    for (;;) {
      try {
        const res = await fetch(url, init);
        if (!retryable || !WAKE_STATUSES.has(res.status) || Date.now() > deadline) return res;
      } catch {
        if (!retryable || Date.now() > deadline) {
          throw new Error("Unable to connect to the server. Check your connection and try again.");
        }
      }
      announceWaking(true);
      attempt += 1;
      await new Promise((resolve) => setTimeout(resolve, Math.min(1500 * attempt, 6000)));
    }
  } finally {
    clearTimeout(slowTimer);
    announceWaking(false);
  }
}

async function request(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const method = (options.method || "GET").toUpperCase();
  // Reads and sign-in change nothing on the server, so repeating them is safe.
  const retryable = method === "GET" || path === "/auth/login";
  const res = await fetchWithWake(`${API_BASE}${path}`, { ...options, headers }, retryable);

  // The session ran out (or the token is no longer valid): send the user back
  // to sign in instead of leaving them on a page that cannot load anything.
  if (res.status === 401 && path !== "/auth/login" && typeof window !== "undefined") {
    clearAuth();
    if (!window.location.pathname.startsWith("/login")) window.location.assign("/login?expired=1");
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!res.ok) {
    const body = await res.text();
    const error = new Error(`API ${path} failed: ${res.status} ${body}`) as Error & { status?: number; detail?: string };
    error.status = res.status;
    try {
      const detail = JSON.parse(body)?.detail;
      if (typeof detail === "string") error.detail = detail;
      else if (detail && typeof detail === "object") {
        error.detail = typeof detail.message === "string" ? detail.message : undefined;
        (error as Error & { data?: unknown }).data = detail;
      }
    } catch {
      // not JSON — no readable explanation to pass on
    }
    throw error;
  }

  return res.json();
}

// File uploads: the browser sets the multipart content type itself.
async function upload(path: string, body: FormData) {
  const headers: Record<string, string> = {};
  if (getToken()) headers["Authorization"] = `Bearer ${getToken()}`;
  const res = await fetch(`${API_BASE}${path}`, { method: "POST", body, headers });
  if (res.status === 401 && typeof window !== "undefined") {
    clearAuth();
    window.location.assign("/login?expired=1");
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!res.ok) {
    const error = new Error(`Upload to ${path} failed: ${res.status}`) as Error & { status?: number; detail?: string };
    error.status = res.status;
    try {
      const detail = (await res.json())?.detail;
      if (typeof detail === "string") error.detail = detail;
    } catch {
      // no readable explanation to pass on
    }
    throw error;
  }
  return res.json();
}

// A file that needs the signed-in person's token: returned as a blob with the
// name the server gave it. Used for downloads and for pictures shown in a page.
export async function fetchFile(path: string): Promise<{ blob: Blob; filename: string }> {
  const headers: Record<string, string> = {};
  if (getToken()) headers["Authorization"] = `Bearer ${getToken()}`;
  const res = await fetchWithWake(`${API_BASE}${path}`, { headers }, true);
  if (res.status === 401 && typeof window !== "undefined") {
    clearAuth();
    window.location.assign("/login?expired=1");
    throw new Error("Your session has expired. Please sign in again.");
  }
  if (!res.ok) {
    const error = new Error(`File ${path} failed: ${res.status}`) as Error & { status?: number; detail?: string };
    error.status = res.status;
    try {
      const detail = (await res.json())?.detail;
      if (typeof detail === "string") error.detail = detail;
    } catch {
      // no readable explanation to pass on
    }
    throw error;
  }
  const named = /filename="?([^";]+)"?/.exec(res.headers.get("Content-Disposition") || "");
  return { blob: await res.blob(), filename: named ? named[1] : path.split("/").pop() || "download" };
}

export async function saveFile(path: string): Promise<string> {
  const { blob, filename } = await fetchFile(path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return filename;
}

export const api = {
  // =========================================================
  // AUTH
  // =========================================================

  login: (email: string, password: string) =>
    request("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: () => request("/auth/me"),

  accountProfile: () => request("/auth/profile"),

  // ---- assistant ----
  assistantStarters: () => request("/assistant/starters"),

  assistantConversations: () => request("/assistant/conversations"),

  assistantConversation: (id: number) => request(`/assistant/conversations/${id}`),

  deleteAssistantConversation: (id: number) =>
    request(`/assistant/conversations/${id}`, { method: "DELETE" }),

  // The reply arrives as a stream of small events (start, status, text, chart,
  // done); `onEvent` is called for each as it comes in.
  assistantChat: async (
    payload: { message: string; conversation_id: number | null },
    onEvent: (event: string, data: any) => void,
    signal?: AbortSignal
  ) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (getToken()) headers["Authorization"] = `Bearer ${getToken()}`;
    const res = await fetch(`${API_BASE}/assistant/chat`, { method: "POST", headers, body: JSON.stringify(payload), signal });
    if (res.status === 401 && typeof window !== "undefined") {
      clearAuth();
      window.location.assign("/login?expired=1");
      throw new Error("Your session has expired. Please sign in again.");
    }
    if (!res.ok || !res.body) {
      const error = new Error("The assistant could not be reached.") as Error & { detail?: string };
      try { error.detail = (await res.json())?.detail; } catch { /* no readable explanation */ }
      throw error;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let event = "message";
        let data = "";
        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (data) {
          try { onEvent(event, JSON.parse(data)); } catch { /* a malformed event is skipped */ }
        }
      }
    }
  },

  // ---- feedback ----
  studentFeedback: () => request("/student/feedback"),

  submitFeedback: (payload: { subject_id: number; faculty_id: number; ratings: Record<string, number>; comment: string | null }) =>
    request("/student/feedback", { method: "POST", body: JSON.stringify(payload) }),

  teacherFeedback: () => request("/teacher/feedback"),

  hodFeedback: (batch?: string) =>
    request(`/hod/feedback${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`),

  hodFacultyFeedback: (facultyId: number, batch?: string) =>
    request(`/hod/feedback/${facultyId}${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`),

  updateAccountProfile: (payload: Record<string, string>) =>
    request("/auth/profile", { method: "PATCH", body: JSON.stringify(payload) }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    }),

  uploadAccountPhoto: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const headers: Record<string, string> = {};
    if (getToken()) headers["Authorization"] = `Bearer ${getToken()}`;
    const res = await fetch(`${API_BASE}/auth/profile/photo`, { method: "POST", body: fd, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Photo upload failed");
    }
    return res.json();
  },

  // =========================================================
  // ADMIN
  // =========================================================

  adminStats: () => request("/admin/stats"),

  adminBatches: () => request("/admin/batches"),

  adminStudents: (params: Record<string, string> = {}) =>
    request(`/admin/students?${new URLSearchParams(params)}`),

  adminDepartments: () => request("/admin/departments"),

  adminAskAI: (question: string) =>
    request("/admin/ask-ai", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  adminFacultyByDept: (deptId: string) =>
    request(`/admin/faculty?department_id=${deptId}`),

  adminSnapshotFiltered: (params: Record<string, string>) =>
    request(`/admin/reports/snapshot?${new URLSearchParams(params)}`),

  adminPlacementsFiltered: (params: Record<string, string>) =>
    request(`/admin/placements?${new URLSearchParams(params)}`),

  adminFaculty: () => request("/admin/faculty"),

  adminSubjects: () => request("/admin/subjects"),

  adminQuery: (payload: any) =>
    request("/admin/reports/query", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  adminSmartQuery: (payload: any) =>
    request("/admin/reports/smart-query", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // =========================================================
  // TEACHER
  // =========================================================

  teacherStudents: (params: Record<string, string> = {}) =>
    request(`/teacher/students?${new URLSearchParams(params)}`),

  teacherMe: () => request("/teacher/me"),

  teacherExtraWork: () => request("/teacher/extra-work"),

  teacherUpdateExtraWorkStatus: (status: string) =>
    request("/teacher/extra-work/status", {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  teacherDeleteExtraWork: () =>
    request("/teacher/extra-work", { method: "DELETE" }),

  teacherSubjects: () => request("/teacher/subjects"),

  teacherSubjectsByScheme: (scheme: string) =>
    request(`/teacher/subjects?scheme=${encodeURIComponent(scheme)}`),

  teacherSchemes: () => request("/teacher/schemes"),

  teacherSubjectLookup: (code: string) =>
    request(`/teacher/subject-lookup?code=${encodeURIComponent(code)}`),

  teacherDashboardStats: () => request("/teacher/dashboard-stats"),

  teacherDashboardStudents: () => request("/teacher/dashboard-students"),

  teacherDashboardSubjects: () => request("/teacher/dashboard-subjects"),

  teacherAtRiskStudents: (filters?: {
    reason?: string;
    semester?: number | string;
    cgpaThreshold?: number | string;
    internalThreshold?: number | string;
  }) => {
    const params = new URLSearchParams();
    if (filters?.reason) params.set("reason", filters.reason);
    if (filters?.semester) params.set("semester", String(filters.semester));
    if (filters?.cgpaThreshold !== undefined && filters.cgpaThreshold !== "")
      params.set("cgpa_threshold", String(filters.cgpaThreshold));
    if (
      filters?.internalThreshold !== undefined &&
      filters.internalThreshold !== ""
    )
      params.set("internal_threshold", String(filters.internalThreshold));
    const qs = params.toString();
    return request(`/teacher/at-risk-students${qs ? `?${qs}` : ""}`);
  },

  teacherNextSemesterForBatch: (batch: string) =>
    request(
      `/teacher/next-semester-for-batch?batch=${encodeURIComponent(batch)}`
    ),

  teacherAssignedSubjects: (batch: string, semester: number) =>
    request(
      `/teacher/assigned-subjects?batch=${encodeURIComponent(
        batch
      )}&semester=${semester}`
    ),

  teacherAssignments: () => request("/teacher/assignments"),

  teacherCreateAssignment: (payload: any) =>
    request("/teacher/assignments", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  teacherDeleteAssignment: (id: number) =>
    request(`/teacher/assignments/${id}`, {
      method: "DELETE",
    }),

  teacherNotes: () => request("/teacher/notes"),

  teacherCreateNote: async (formData: FormData) => {
    const headers: Record<string, string> = {};
    if (getToken()) headers["Authorization"] = `Bearer ${getToken()}`;
    const res = await fetch(`${API_BASE}/teacher/notes`, {
      method: "POST",
      body: formData,
      headers,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Failed to post");
    }
    return res.json();
  },

  teacherDeleteNote: (id: number) =>
    request(`/teacher/notes/${id}`, { method: "DELETE" }),

  teacherActiveBatches: () => request("/teacher/active-batches"),

  teacherMyBatches: () => request("/teacher/my-batches"),

  teacherPassedOutBatches: () => request("/teacher/passed-out-batches"),

  teacherAskAI: (question: string) =>
    request("/teacher/ask-ai", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  teacherInsight: () => request("/teacher/insight"),

  // =========================================================
  // PPT GENERATOR
  // =========================================================

  generatePPT: (payload: any) =>
    request("/teacher/generate-ppt", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  uploadStyleReference: async (
    outputType: string,
    file: File,
    subjectId?: number
  ) => {
    const fd = new FormData();

    fd.append("output_type", outputType);
    fd.append("file", file);

    if (subjectId) {
      fd.append("subject_id", String(subjectId));
    }

    const headers: Record<string, string> = {};

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    let res: Response;

    try {
      res = await fetch(
        `${API_BASE}/teacher/style-references/upload`,
        {
          method: "POST",
          body: fd,
          headers,
        }
      );
    } catch {
      throw new Error(
        "Unable to connect to the server. Check your connection and try again."
      );
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));

      throw new Error(
        error.detail ||
          `Style reference upload failed with status ${res.status}`
      );
    }

    return res.json();
  },

  listStyleReferences: (
    outputType?: string,
    subjectId?: number
  ) => {
    const params = new URLSearchParams();

    if (outputType) {
      params.set("output_type", outputType);
    }

    if (subjectId) {
      params.set("subject_id", String(subjectId));
    }

    return request(`/teacher/style-references?${params}`);
  },

  deleteStyleReference: (id: number) =>
    request(`/teacher/style-references/${id}`, {
      method: "DELETE",
    }),

  uploadContentSource: async (
    file: File,
    subjectId?: number
  ) => {
    const fd = new FormData();

    fd.append("file", file);

    if (subjectId) {
      fd.append("subject_id", String(subjectId));
    }

    const headers: Record<string, string> = {};

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    let res: Response;

    try {
      res = await fetch(
        `${API_BASE}/teacher/content-sources/upload`,
        {
          method: "POST",
          body: fd,
          headers,
        }
      );
    } catch {
      throw new Error(
        "Unable to connect to the server. Check your connection and try again."
      );
    }

    if (!res.ok) {
      const error = await res.json().catch(() => ({}));

      throw new Error(
        error.detail ||
          `Content source upload failed with status ${res.status}`
      );
    }

    return res.json();
  },

  listContentSources: (subjectId?: number) => {
    const params = new URLSearchParams();

    if (subjectId) {
      params.set("subject_id", String(subjectId));
    }

    return request(`/teacher/content-sources?${params}`);
  },

  deleteContentSource: (id: number) =>
    request(`/teacher/content-sources/${id}`, {
      method: "DELETE",
    }),

  generateStyledContent: (payload: any) =>
    request("/teacher/generate-styled-content", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listGeneratedPresentations: () =>
    request("/teacher/generated-presentations"),

  getGeneratedPresentation: (id: number) =>
    request(`/teacher/generated-presentations/${id}`),

  createModuleMapping: (payload: any) =>
    request("/teacher/module-mappings", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listModuleMappings: (contentSourceId: number) =>
    request(
      `/teacher/module-mappings?content_source_id=${contentSourceId}`
    ),

  deleteModuleMapping: (id: number) =>
    request(`/teacher/module-mappings/${id}`, {
      method: "DELETE",
    }),

  slideThemes: () => request("/teacher/slide-themes"),

  slideImage: (title: string, n = 0) =>
    request(`/teacher/slide-image?q=${encodeURIComponent(title)}&n=${n}`),

  exportPPT: async (
    topic: string,
    slides: any[],
    styleReferenceId?: number,
    options: { theme?: string; includeImages?: boolean } = {}
  ) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    const res = await fetch(
      `${API_BASE}/teacher/export-ppt`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          topic,
          slides,
          style_reference_id: styleReferenceId,
          theme: options.theme,
          include_images: options.includeImages !== false,
        }),
      }
    );

    if (!res.ok) {
      throw new Error("Export failed");
    }

    return res.blob();
  },

  exportNotes: async (
    topic: string,
    notes: string
  ) => {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    const res = await fetch(
      `${API_BASE}/teacher/export-notes`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          topic,
          notes,
        }),
      }
    );

    if (!res.ok) {
      throw new Error("Export failed");
    }

    return res.blob();
  },

  // =========================================================
  // TEACHER SEMESTER / MARKS / ATTENDANCE
  // =========================================================

  teacherAvailableSemesters: (batch?: string) =>
    request(
      `/teacher/available-semesters${
        batch ? `?batch=${batch}` : ""
      }`
    ),

  teacherAvailableSections: (
    batch?: string,
    semester?: number
  ) => {
    const params = new URLSearchParams();

    if (batch) {
      params.set("batch", batch);
    }

    if (semester) {
      params.set("semester", String(semester));
    }

    return request(`/teacher/available-sections?${params}`);
  },

  teacherMarks: (
    subjectId: number,
    semester: number,
    batch?: string
  ) =>
    request(
      `/teacher/marks?subject_id=${subjectId}&semester=${semester}${
        batch ? `&batch=${batch}` : ""
      }`
    ),

  teacherSaveMarks: (payload: any) =>
    request("/teacher/marks", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  teacherSaveMarksBulk: (payload: any[]) =>
    request("/teacher/marks/bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  teacherPerformanceV2: (
    semester: number,
    mode: string,
    subjectId?: number,
    batch?: string
  ) =>
    request(
      `/teacher/performance?semester=${semester}&mode=${mode}${
        subjectId ? `&subject_id=${subjectId}` : ""
      }${batch ? `&batch=${batch}` : ""}`
    ),

  teacherStudentsWithBacklogs: (
    semester: number,
    batch?: string
  ) =>
    request(
      `/teacher/students-with-backlogs?semester=${semester}${
        batch ? `&batch=${batch}` : ""
      }`
    ),

  teacherAttendanceHistory: (subjectId?: number) =>
    request(
      `/teacher/attendance-history${
        subjectId ? `?subject_id=${subjectId}` : ""
      }`
    ),

  teacherAttendanceSession: (sessionId: number) =>
    request(`/teacher/attendance-session/${sessionId}`),

  teacherEditAttendance: (
    sessionId: number,
    records: any
  ) =>
    request(`/teacher/attendance/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify(records),
    }),

  teacherDeleteAttendanceSession: (sessionId: number) =>
    request(`/teacher/attendance/${sessionId}`, {
      method: "DELETE",
    }),

  teacherAttendanceAnalytics: (subjectId: number, date: string) =>
    request(
      `/teacher/attendance-analytics?subject_id=${subjectId}&date=${encodeURIComponent(date)}`
    ),

  markAttendance: (payload: any) =>
    request("/teacher/attendance", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  teacherAtRisk: (batch?: string) =>
    request(
      `/teacher/at-risk${batch ? `?batch=${batch}` : ""}`
    ),

  teacherPerformance: (batch?: string) =>
    request(
      `/teacher/performance${batch ? `?batch=${batch}` : ""}`
    ),

  teacherAttendanceReport: (filters?: { subjectId?: number; semester?: number | string; date?: string }) => {
    const params = new URLSearchParams();
    if (filters?.subjectId) params.set("subject_id", String(filters.subjectId));
    if (filters?.semester) params.set("semester", String(filters.semester));
    if (filters?.date) params.set("date", filters.date);
    const qs = params.toString();
    return request(`/teacher/reports/attendance${qs ? `?${qs}` : ""}`);
  },

  teacherPerformanceReport: (batch?: string) =>
    request(
      `/teacher/reports/performance${
        batch ? `?batch=${batch}` : ""
      }`
    ),

  // =========================================================
  // QUESTION BANK
  // =========================================================

  questionBankSubjects: () =>
    request("/teacher/question-bank/subjects"),

  questionBankChunks: (
    subjectFolder: string,
    difficulty?: string,
    bloomLevel?: string
  ) => {
    const params = new URLSearchParams({
      subject_folder: subjectFolder,
    });

    if (difficulty) {
      params.set("difficulty", difficulty);
    }

    if (bloomLevel) {
      params.set("bloom_level", bloomLevel);
    }

    return request(`/teacher/question-bank?${params}`);
  },

  // =========================================================
  // QUESTION PAPER GENERATOR
  // =========================================================

  uploadQuestionPaperDocument: async (
    kind: "notes" | "important_questions",
    file: File,
    moduleHint?: string
  ) => {
    if (!file) {
      throw new Error("No file selected.");
    }

    const allowedTypes = [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];

    const extension = file.name
      .toLowerCase()
      .split(".")
      .pop();

    if (
      extension !== "pdf" &&
      extension !== "docx" &&
      !allowedTypes.includes(file.type)
    ) {
      throw new Error(
        "Only PDF and DOCX files are allowed."
      );
    }

    if (file.size === 0) {
      throw new Error(
        "The selected file is empty."
      );
    }

    if (file.size > 100 * 1024 * 1024) {
      throw new Error(
        "The selected file is larger than 100 MB."
      );
    }

    const form = new FormData();

    /*
     * IMPORTANT:
     * Do NOT manually set Content-Type here.
     * The browser automatically creates the correct
     * multipart/form-data boundary.
     */
    form.append("document_kind", kind);
    if (moduleHint) {
      form.append("module_hint", moduleHint);
    }
    form.append("file", file, file.name);

    const headers: Record<string, string> = {};

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    let response: Response;

    try {
      response = await fetch(
        `${API_BASE}/teacher/question-paper/upload`,
        {
          method: "POST",
          headers,
          body: form,
        }
      );
    } catch (error) {
      console.error(
        "Question paper upload network error:",
        error
      );

      throw new Error(
        "Unable to connect to the server. Check your connection and try again."
      );
    }

    const contentType =
      response.headers.get("content-type") || "";

    let responseBody: any;

    if (contentType.includes("application/json")) {
      responseBody = await response
        .json()
        .catch(() => ({}));
    } else {
      responseBody = await response
        .text()
        .catch(() => "");
    }

    if (!response.ok) {
      console.error(
        "Question paper upload failed:",
        {
          status: response.status,
          statusText: response.statusText,
          response: responseBody,
        }
      );

      let message = "Question paper upload failed.";

      if (
        responseBody &&
        typeof responseBody === "object" &&
        responseBody.detail
      ) {
        message = responseBody.detail;
      } else if (
        typeof responseBody === "string" &&
        responseBody.trim()
      ) {
        message = responseBody;
      } else if (response.status === 401) {
        message =
          "Your teacher session has expired. Please log in again.";
      } else if (response.status === 403) {
        message =
          "You are not authorized to upload question-paper documents.";
      } else if (response.status === 404) {
        message =
          "Document upload is unavailable right now. Please try again later.";
      } else if (response.status === 413) {
        message =
          "The selected file is too large.";
      } else if (response.status >= 500) {
        message =
          "Something went wrong while processing the document. Please try again.";
      }

      throw new Error(
        `${message} (HTTP ${response.status})`
      );
    }

    return responseBody;
  },

  generateQuestionPaper: (payload: any) =>
    request("/teacher/question-paper/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  saveQuestionPaper: (payload: any) =>
    request("/teacher/question-paper/save", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  replaceQuestionPaperQuestion: (payload: any) =>
    request("/teacher/question-paper/replace-question", { method: "POST", body: JSON.stringify(payload) }),

  listQuestionPaperDocuments: () => request("/teacher/question-paper/documents"),

  deleteQuestionPaperDocument: (id: number) =>
    request(`/teacher/question-paper/documents/${id}`, { method: "DELETE" }),

  listQuestionPapers: () =>
    request("/teacher/question-paper"),

  getQuestionPaper: (id: number) =>
    request(`/teacher/question-paper/${id}`),

  deleteQuestionPaper: (id: number) =>
    request(`/teacher/question-paper/${id}`, {
      method: "DELETE",
    }),

  // =========================================================
  // STUDENT
  // =========================================================

  studentDashboard: () =>
    request("/student/dashboard"),

  uploadProfilePhoto: async (file: File) => {
    const fd = new FormData();

    fd.append("file", file);

    const headers: Record<string, string> = {};

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    const res = await fetch(
      `${API_BASE}/student/profile/photo`,
      {
        method: "POST",
        body: fd,
        headers,
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));

      throw new Error(
        err.detail || "Photo upload failed"
      );
    }

    return res.json();
  },

  excellenceScore: () =>
    request("/student/excellence-score"),

  askAI: (question: string) =>
    request("/student/ask-ai", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  studentInsight: () =>
    request("/student/insight"),

  studentRank: () =>
    request("/student/rank"),

  studentAchievements: () =>
    request("/student/achievements"),

  studentDocuments: () =>
    request("/student/documents"),

  updateProfile: (payload: any) =>
    request("/student/profile", {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  addAchievement: async (formData: FormData) => {
    const headers: Record<string, string> = {};

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    const res = await fetch(
      `${API_BASE}/student/achievements`,
      {
        method: "POST",
        body: formData,
        headers,
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));

      throw new Error(
        err.detail || "Failed to add achievement"
      );
    }

    return res.json();
  },

  editAchievement: (
    id: number,
    payload: any
  ) =>
    request(`/student/achievements/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  reuploadAchievementFile: async (
    id: number,
    formData: FormData
  ) => {
    const headers: Record<string, string> = {};

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    const res = await fetch(
      `${API_BASE}/student/achievements/${id}/reupload`,
      {
        method: "POST",
        body: formData,
        headers,
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));

      throw new Error(
        err.detail || "Re-upload failed"
      );
    }

    return res.json();
  },

  deleteAchievement: (id: number) =>
    request(`/student/achievements/${id}`, {
      method: "DELETE",
    }),

  deleteCertificate: (id: number) =>
    request(`/student/certificates/${id}`, {
      method: "DELETE",
    }),

  requestDocument: (payload: any) =>
    request("/student/documents", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  myPlacement: () =>
    request("/student/placement"),

  myCourses: () =>
    request("/student/courses"),

  myCounseling: () =>
    request("/student/counseling"),

  myCertificates: () =>
    request("/student/certificates"),

  updateCertificateLabel: (
    id: number,
    label: string
  ) =>
    request(
      `/student/certificates/${id}?label=${encodeURIComponent(
        label
      )}`,
      {
        method: "PATCH",
      }
    ),

  uploadCertificate: async (
    file: File,
    label: string,
    certificateId?: number
  ) => {
    const formData = new FormData();

    formData.append("file", file);
    formData.append("label", label);

    if (certificateId) {
      formData.append(
        "certificate_id",
        String(certificateId)
      );
    }

    const headers: Record<string, string> = {};

    if (getToken()) {
      headers["Authorization"] = `Bearer ${getToken()}`;
    }

    const res = await fetch(
      `${API_BASE}/student/certificates/upload`,
      {
        method: "POST",
        body: formData,
        headers,
      }
    );

    if (!res.ok) {
      throw new Error("Upload failed");
    }

    return res.json();
  },

  myInternships: () =>
    request("/student/internships"),

  myAttendance: () =>
    request("/student/attendance"),

  studentNotes: () =>
    request("/student/notes"),

  updateEducation: (education: any[]) =>
    request("/student/education", {
      method: "PATCH",
      body: JSON.stringify({ education }),
    }),

  uploadResumeFile: async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const headers: Record<string, string> = {};
    if (getToken()) headers["Authorization"] = `Bearer ${getToken()}`;
    const res = await fetch(`${API_BASE}/student/profile/resume`, { method: "POST", body: fd, headers });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Resume upload failed");
    }
    return res.json();
  },

  deleteResumeFile: () =>
    request("/student/profile/resume", { method: "DELETE" }),

  // =========================================================
  // ADMIN REMAINING
  // =========================================================

  adminInternships: () =>
    request("/admin/internships"),

  adminSnapshot: () =>
    request("/admin/reports/snapshot"),

  adminSnapshotByBatch: (batch: string) =>
    request(
      `/admin/reports/snapshot?batch=${encodeURIComponent(batch)}`
    ),

  adminPlacements: () =>
    request("/admin/placements"),

  adminPlacementsByBatch: (batch: string) =>
    request(
      `/admin/placements?batch=${encodeURIComponent(batch)}`
    ),

  adminCourses: () =>
    request("/admin/courses"),

  adminFacultyCreate: (payload: any) =>
    request("/admin/faculty", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  adminFacultyDelete: (id: number) =>
    request(`/admin/faculty/${id}`, {
      method: "DELETE",
    }),

  adminStudentCreate: (payload: any) =>
    request("/admin/students", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  adminStudentDelete: (id: number) =>
    request(`/admin/students/${id}`, {
      method: "DELETE",
    }),

  adminStudentEdit: (
    id: number,
    payload: any
  ) =>
    request(`/admin/students/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  adminFacultyEdit: (
    id: number,
    payload: any
  ) =>
    request(`/admin/faculty/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),

  adminDocuments: (status?: string) =>
    request(
      `/admin/documents${
        status ? `?status=${status}` : ""
      }`
    ),

  adminDocumentUpdate: (
    id: number,
    status: string
  ) =>
    request(`/admin/documents/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),

  adminSubjectVerify: (id: number) =>
    request(`/admin/subjects/${id}/verify`, {
      method: "PATCH",
    }),

  adminActivityLogs: () =>
    request("/admin/activity-logs"),

  // =========================================================
  // COUNSELING / SEARCH / NOTIFICATIONS
  // =========================================================

  teacherCounseling: (studentId: number) =>
    request(`/teacher/counseling/${studentId}`),

  teacherCounselingHistory: () =>
    request("/teacher/counseling-history"),

  teacherAddCounseling: (payload: any) =>
    request("/teacher/counseling", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  teacherAddCounselingBulk: (payload: { batch: string; semester: number; section?: string; note: string; student_ids?: number[] }) =>
    request("/teacher/counseling/bulk", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  teacherEditCounseling: (noteId: number, note: string) =>
    request(`/teacher/counseling/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    }),

  teacherDeleteCounseling: (noteId: number) =>
    request(`/teacher/counseling/${noteId}`, {
      method: "DELETE",
    }),

  teacherReplyCounseling: (noteId: number, reply: string) =>
    request(`/teacher/counseling/${noteId}/reply`, {
      method: "PATCH",
      body: JSON.stringify({ reply }),
    }),

  studentReplyCounseling: (noteId: number, status: string, description?: string) =>
    request(`/student/counseling/${noteId}/reply`, {
      method: "PATCH",
      body: JSON.stringify({ status, description }),
    }),

  studentDeleteCounselingReply: (noteId: number) =>
    request(`/student/counseling/${noteId}/reply`, {
      method: "DELETE",
    }),

  globalSearch: (q: string) =>
    request(`/search?q=${encodeURIComponent(q)}`),

  // ---- project report and presentation builder ----
  projectFormats: () => request("/project-formats"),

  projectFormat: (id: number) => request(`/project-formats/${id}`),

  uploadProjectFormat: (file: File, fields: { kind: string; name: string; project_type?: string; batch?: string; department_id?: string }) => {
    const fd = new FormData();
    fd.append("file", file);
    for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
    return upload("/project-formats", fd);
  },

  editProjectFormat: (id: number, payload: Record<string, unknown>) =>
    request(`/project-formats/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  projectFormatPages: (id: number) => request(`/project-formats/${id}/pages`),

  deleteProjectFormat: (id: number) => request(`/project-formats/${id}`, { method: "DELETE" }),

  myProjects: () => request("/student/projects"),

  projectStart: () => request("/student/projects/start"),

  projectClassmates: (q: string) => request(`/student/projects/classmates?q=${encodeURIComponent(q)}`),

  createProject: (payload: Record<string, unknown>) =>
    request("/student/projects", { method: "POST", body: JSON.stringify(payload) }),

  project: (id: number) => request(`/student/projects/${id}`),

  editProject: (id: number, payload: Record<string, unknown>) =>
    request(`/student/projects/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  deleteProject: (id: number) => request(`/student/projects/${id}`, { method: "DELETE" }),

  addProjectMaterial: (id: number, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return upload(`/student/projects/${id}/materials`, fd);
  },

  removeProjectMaterial: (id: number, materialId: number) =>
    request(`/student/projects/${id}/materials/${materialId}`, { method: "DELETE" }),

  editProjectImage: (id: number, imageId: number, caption: string) =>
    request(`/student/projects/${id}/images/${imageId}`, { method: "PATCH", body: JSON.stringify({ caption }) }),

  deleteProjectImage: (id: number, imageId: number) =>
    request(`/student/projects/${id}/images/${imageId}`, { method: "DELETE" }),

  startProjectJob: (id: number, payload: Record<string, unknown>) =>
    request(`/student/projects/${id}/jobs`, { method: "POST", body: JSON.stringify(payload) }),

  projectJob: (id: number, jobId: number) => request(`/student/projects/${id}/jobs/${jobId}`),

  restoreProjectVersion: (id: number, version: number) =>
    request(`/student/projects/${id}/versions/${version}/restore`, { method: "POST" }),

  shareProject: (id: number, facultyId: number | null) =>
    request(`/student/projects/${id}/share`, { method: "PUT", body: JSON.stringify({ faculty_id: facultyId }) }),

  commentOnProject: (id: number, section: string, body: string, submissionId?: number) =>
    request(`/student/projects/${id}/comments`, { method: "POST", body: JSON.stringify({ section, body, ...(submissionId ? { submission_id: submissionId } : {}) }) }),

  // A ready-made report or presentation sent straight to a guide. Either
  // `project_id` (an existing project) or `title` (a new one) is given.
  submitToGuide: (fields: { guide_id: number; note: string; client_token: string; project_id?: number; title?: string }, files: File[]) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== "") fd.append(k, String(v)); });
    files.forEach((f) => fd.append("files", f));
    return upload("/student/project-submissions", fd);
  },

  mySubmissions: () => request("/student/project-submissions"),

  markSubmissionsSeen: () => request("/student/project-submissions/seen", { method: "POST" }),

  resolveProjectComment: (id: number, commentId: number) =>
    request(`/student/projects/${id}/comments/${commentId}`, { method: "PATCH" }),

  projectReviews: () => request("/teacher/project-reviews"),

  projectReview: (id: number) => request(`/teacher/project-reviews/${id}`),

  guideComment: (id: number, section: string, body: string, submission?: { id: number; status: "reviewed" | "changes_requested" }) =>
    request(`/teacher/project-reviews/${id}/comments`, { method: "POST", body: JSON.stringify({ section, body, ...(submission ? { submission_id: submission.id, status: submission.status } : {}) }) }),

  pageCount: (base: string) => request(base),

  // ---- feedback switch ----
  teacherFeedbackWindows: () => request("/teacher/feedback/windows"),

  setTeacherFeedbackWindow: (subjectId: number, open: boolean) =>
    request("/teacher/feedback/windows", { method: "PUT", body: JSON.stringify({ subject_id: subjectId, open }) }),

  hodFeedbackWindows: (facultyId: number) => request(`/hod/feedback/${facultyId}/windows`),

  setHodFeedbackWindow: (facultyId: number, subjectId: number, open: boolean) =>
    request("/hod/feedback/windows", { method: "PUT", body: JSON.stringify({ faculty_id: facultyId, subject_id: subjectId, open }) }),

  // ---- student planner ----
  planner: () => request("/student/planner"),

  addPlannerItem: (payload: Record<string, unknown>) =>
    request("/student/planner", { method: "POST", body: JSON.stringify(payload) }),

  editPlannerItem: (id: number, payload: Record<string, unknown>) =>
    request(`/student/planner/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  deletePlannerItem: (id: number) => request(`/student/planner/${id}`, { method: "DELETE" }),

  studentCalendar: () => request("/student/calendar"),

  // ---- announcements ----
  announcements: () => request("/announcements"),

  postAnnouncement: (payload: Record<string, unknown>) =>
    request("/announcements", { method: "POST", body: JSON.stringify(payload) }),

  deleteAnnouncement: (id: number) => request(`/announcements/${id}`, { method: "DELETE" }),

  teacherPlacements: () => request("/teacher/placements"),

  // ---- admin: logins ----
  adminLogins: (params: Record<string, string> = {}) =>
    request(`/admin/logins?${new URLSearchParams(params).toString()}`),

  adminCreateLogin: (payload: Record<string, unknown>) =>
    request("/admin/logins", { method: "POST", body: JSON.stringify(payload) }),

  adminEditLogin: (id: number, payload: Record<string, unknown>) =>
    request(`/admin/logins/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  adminResetPassword: (id: number) => request(`/admin/logins/${id}/reset-password`, { method: "POST" }),

  adminImportStudents: (file: File, options: { apply: boolean; createLogins: boolean; departmentId?: string }) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("apply", options.apply ? "true" : "false");
    fd.append("create_logins", options.createLogins ? "true" : "false");
    if (options.departmentId) fd.append("department_id", options.departmentId);
    return upload("/admin/import/students", fd);
  },

  // ---- admin: departments and subjects ----
  adminStructure: () => request("/admin/structure"),

  adminCreateDepartment: (name: string) =>
    request("/admin/departments", { method: "POST", body: JSON.stringify({ name }) }),

  adminRenameDepartment: (id: number, name: string) =>
    request(`/admin/departments/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),

  adminSubjectAllocation: () => request("/admin/subjects/allocation"),

  adminCreateSubject: (payload: Record<string, unknown>) =>
    request("/admin/subjects", { method: "POST", body: JSON.stringify(payload) }),

  adminEditSubject: (id: number, payload: Record<string, unknown>) =>
    request(`/admin/subjects/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),

  // ---- placement and internship records (admin, and HOD for own department) ----
  placementRecords: (batch?: string) =>
    request(`/admin/placement-records${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`),

  savePlacementRecord: (kind: "placements" | "internships", id: number | null, payload: Record<string, unknown>) =>
    request(`/admin/placement-records/${kind}${id ? `/${id}` : ""}`, { method: id ? "PATCH" : "POST", body: JSON.stringify(payload) }),

  deletePlacementRecord: (kind: "placements" | "internships", id: number) =>
    request(`/admin/placement-records/${kind}/${id}`, { method: "DELETE" }),

  importPlacementRecords: (files: { placements?: File | null; internships?: File | null }, apply: boolean) => {
    const fd = new FormData();
    if (files.placements) fd.append("placements", files.placements);
    if (files.internships) fd.append("internships", files.internships);
    fd.append("apply", apply ? "true" : "false");
    return upload("/admin/placement-records/import", fd);
  },

  myNotifications: () =>
    request("/notifications"),

  markNotificationRead: (id: number) =>
    request(`/notifications/${id}/read`, {
      method: "PATCH",
    }),

  markAllNotificationsRead: () =>
    request("/notifications/read-all", {
      method: "PATCH",
    }),

  // =========================================================
  // HOD
  // =========================================================

  hodMe: () =>
    request("/hod/me"),

  hodAskAI: (question: string) =>
    request("/hod/ask-ai", {
      method: "POST",
      body: JSON.stringify({ question }),
    }),

  hodInsight: () => request("/hod/insight"),

  hodStats: (filters?: { backlogBatch?: string; topperfBatch?: string; topperfLimit?: number }) => {
    const params = new URLSearchParams();
    if (filters?.backlogBatch) params.set("backlog_batch", filters.backlogBatch);
    if (filters?.topperfBatch) params.set("topperf_batch", filters.topperfBatch);
    if (filters?.topperfLimit) params.set("topperf_limit", String(filters.topperfLimit));
    const qs = params.toString();
    return request(`/hod/stats${qs ? `?${qs}` : ""}`);
  },

  hodStudents: (
    params: Record<string, string> = {}
  ) =>
    request(
      `/hod/students?${new URLSearchParams(params)}`
    ),

  hodStudentsByBatch: () =>
    request("/hod/students-by-batch"),

  hodFaculty: () =>
    request("/hod/faculty"),

  hodFacultySubjects: (facultyId: number) =>
    request(`/hod/faculty/${facultyId}/subjects`),

  hodSubjects: () =>
    request("/hod/subjects"),

  hodFacultyWorkload: () =>
    request("/hod/faculty-workload"),

  hodPlacements: (batch?: string) =>
    request(`/hod/placements${batch ? `?batch=${encodeURIComponent(batch)}` : ""}`),

  hodPlacementBatches: () =>
    request("/hod/placement-batches"),

  hodPlacementComparison: (batches: string[]) =>
    request(`/hod/placement-comparison?batches=${encodeURIComponent(batches.join(","))}`),

  hodUpdateExtraWork: (
    facultyId: number,
    extraWork: string
  ) =>
    request(
      `/hod/faculty/${facultyId}/extra-work`,
      {
        method: "PATCH",
        body: JSON.stringify({
          extra_work: extraWork,
        }),
      }
    ),

  hodStudentsFiltered: (
    params: Record<string, string>
  ) =>
    request(
      `/hod/students?${new URLSearchParams(params)}`
    ),

  hodQuery: (payload: any) =>
    request("/hod/reports/query", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};
