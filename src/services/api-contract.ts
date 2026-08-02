export interface ApiResponse<T> {
  code: number
  message: string
  data: T
  request_id: string
}

export interface ApiError {
  code: number
  message: string
  request_id?: string
  details?: unknown
}

export const API_BASE = '/api/v1'
export const ADMIN_API_BASE = `${API_BASE}/admin`
export const INTERNAL_API_BASE = '/internal/v1'
export const API_VERSION = API_BASE
export const ADMIN_API_PREFIX = ADMIN_API_BASE
export const INTERNAL_API_PREFIX = INTERNAL_API_BASE

// Keep every xiao_dun frontend path in this file. The repository contract
// checker compares apiPath(...) declarations against contract-manifest.json.
function apiPath<T extends string>(path: T): T {
  return path
}

function internalPath<T extends string>(path: T): T {
  return path
}

export const API_PATHS = {
  auth: {
    login: apiPath(`${API_BASE}/auth/login`),
    refresh: apiPath(`${API_BASE}/auth/refresh`),
    logout: apiPath(`${API_BASE}/auth/logout`),
  },
  users: {
    me: apiPath(`${API_BASE}/users/me`),
  },
  devices: {
    bind: apiPath(`${API_BASE}/devices/bind`),
    list: apiPath(`${API_BASE}/devices`),
    detail: (deviceId: string) => apiPath(`${API_BASE}/devices/${deviceId}`),
  },
  analysis: {
    tasks: {
      create: apiPath(`${API_BASE}/analysis/tasks`),
      detail: (taskId: string) => apiPath(`${API_BASE}/analysis/tasks/${taskId}`),
      cancel: (taskId: string) => apiPath(`${API_BASE}/analysis/tasks/${taskId}/cancel`),
    },
    records: {
      list: apiPath(`${API_BASE}/analysis-records`),
      stats: apiPath(`${API_BASE}/analysis-records/stats`),
      detail: (recordId: string) => apiPath(`${API_BASE}/analysis-records/${recordId}`),
    },
  },
  reports: {
    list: apiPath(`${API_BASE}/reports`),
    detail: (reportId: string) => apiPath(`${API_BASE}/reports/${reportId}`),
    feedback: (reportId: string) => apiPath(`${API_BASE}/reports/${reportId}/feedback`),
  },
  fraud: {
    statistics: {
      provinces: apiPath(`${API_BASE}/fraud-statistics/provinces`),
    },
    cases: {
      list: apiPath(`${API_BASE}/fraud-cases`),
      create: apiPath(`${API_BASE}/fraud-cases`),
      stats: apiPath(`${API_BASE}/fraud-cases/stats`),
      import: apiPath(`${API_BASE}/fraud-cases/import`),
      importAsync: apiPath(`${API_BASE}/fraud-cases/import-async`),
      reindex: apiPath(`${API_BASE}/fraud-cases/reindex`),
      search: apiPath(`${API_BASE}/fraud-cases/search`),
      importJobs: (jobId: string) => apiPath(`${API_BASE}/fraud-cases/import-jobs/${jobId}`),
      detail: (caseId: string) => apiPath(`${API_BASE}/fraud-cases/${caseId}`),
    },
  },
  uploads: {
    create: apiPath(`${API_BASE}/uploads`),
    detail: (uploadId: string) => apiPath(`${API_BASE}/uploads/${uploadId}`),
    ocr: (uploadId: string) => apiPath(`${API_BASE}/uploads/${uploadId}/ocr`),
    preview: (uploadId: string) => apiPath(`${API_BASE}/uploads/${uploadId}/preview`),
  },
  admin: {
    dashboard: {
      overview: apiPath(`${API_BASE}/admin/dashboard/overview`),
    },
    events: {
      list: apiPath(`${API_BASE}/admin/events`),
      detail: (eventId: string) => apiPath(`${API_BASE}/admin/events/${eventId}`),
    },
    rules: {
      list: apiPath(`${API_BASE}/admin/rules`),
      detail: (ruleId: string) => apiPath(`${API_BASE}/admin/rules/${ruleId}`),
      publish: (ruleId: string) => apiPath(`${API_BASE}/admin/rules/${ruleId}/publish`),
    },
    knowledge: {
      documents: {
        list: apiPath(`${API_BASE}/admin/knowledge/documents`),
        detail: (documentId: string) => apiPath(`${API_BASE}/admin/knowledge/documents/${documentId}`),
        index: (documentId: string) => apiPath(`${API_BASE}/admin/knowledge/documents/${documentId}/index`),
      },
    },
    prompts: {
      list: apiPath(`${API_BASE}/admin/prompts`),
      detail: (promptId: string) => apiPath(`${API_BASE}/admin/prompts/${promptId}`),
      publish: (promptId: string) => apiPath(`${API_BASE}/admin/prompts/${promptId}/publish`),
    },
    models: {
      list: apiPath(`${API_BASE}/admin/models`),
    },
    releases: {
      create: apiPath(`${API_BASE}/admin/releases`),
    },
    auditLogs: {
      list: apiPath(`${API_BASE}/admin/audit-logs`),
    },
    system: {
      health: apiPath(`${API_BASE}/admin/system/health`),
    },
  },
} as const

export const INTERNAL_API_PATHS = {
  ai: {
    analyze: internalPath(`${INTERNAL_API_BASE}/ai/analyze`),
    health: internalPath(`${INTERNAL_API_BASE}/ai/health`),
  },
  rules: {
    match: internalPath(`${INTERNAL_API_BASE}/rules/match`),
  },
  rag: {
    search: internalPath(`${INTERNAL_API_BASE}/rag/search`),
  },
  model: {
    chat: internalPath(`${INTERNAL_API_BASE}/model/chat`),
    embeddings: internalPath(`${INTERNAL_API_BASE}/model/embeddings`),
    rerank: internalPath(`${INTERNAL_API_BASE}/model/rerank`),
    health: internalPath(`${INTERNAL_API_BASE}/model/health`),
  },
} as const

// Backward-compatible export name for consumers created during the first
// admin-web phase. New code should use API_PATHS.
export const apiPaths = API_PATHS
