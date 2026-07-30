import type { ApiResponse } from './api-contract'

export const API_BASE_URL = (globalThis as { __XIAO_DUN_API_BASE_URL__?: string }).__XIAO_DUN_API_BASE_URL__
  || (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : 'http://localhost:3721')

const DEFAULT_TIMEOUT_MS = 15_000

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${API_BASE_URL.replace(/\/$/, '')}${normalizedPath}`
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
  const controller = new AbortController()
  const timeoutMs = Number(options.headers instanceof Headers
    ? options.headers.get('x-timeout-ms')
    : (options.headers as Record<string, string> | undefined)?.['x-timeout-ms']) || DEFAULT_TIMEOUT_MS
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('xiao-dun-access-token') : null
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)

  try {
    const response = await fetch(apiUrl(path), { ...options, headers, signal: controller.signal })
    const payload = await response.json().catch(() => ({})) as Partial<ApiResponse<T>>
    if (!response.ok) {
      const error = new Error(payload.message || `Request failed with status ${response.status}`) as Error & { status?: number; request_id?: string }
      error.status = response.status
      error.request_id = payload.request_id
      throw error
    }
    return {
      code: Number(payload.code ?? 0),
      message: String(payload.message ?? 'ok'),
      data: payload.data as T,
      request_id: String(payload.request_id ?? ''),
    }
  } finally {
    clearTimeout(timeout)
  }
}
