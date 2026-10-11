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

async function request(path: string, options: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string> | undefined),
  };

  const token = getToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  let res: Response;

  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new Error(
      "Unable to connect to the server. Check your connection and try again."
    );
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${path} failed: ${res.status} ${body}`);
  }

  return res.json();
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

  exportPPT: async (
    topic: string,
    slides: any[],
    styleReferenceId?: number
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
        `Cannot connect to the Anviksha backend at ${API_BASE}. Make sure the FastAPI server is running.`
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
          "Question paper upload API was not found. Please check that the latest backend is running.";
      } else if (response.status === 413) {
        message =
          "The selected file is too large.";
      } else if (response.status >= 500) {
        message =
          "The backend encountered an error while processing the document.";
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
