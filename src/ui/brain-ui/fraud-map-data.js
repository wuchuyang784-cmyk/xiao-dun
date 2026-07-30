import { API } from './api-client.js'
import { FRAUD_API_PATHS } from './fraud-map-api.js'

export async function fetchFraudSnapshot({ signal } = {}) {
  const response = await fetch(`${API}${FRAUD_API_PATHS.statistics.provinces}`, { signal })
  if (!response.ok) throw new Error(`fraud snapshot request failed: ${response.status}`)
  const body = await response.json()
  return body.data?.data || body.data || body
}

export async function fetchFraudCases({ provinceCode = '', limit = 30, signal } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (provinceCode) params.set('provinceCode', provinceCode)
  const response = await fetch(`${API}${FRAUD_API_PATHS.cases.list}?${params}`, { signal })
  if (!response.ok) throw new Error(`fraud cases request failed: ${response.status}`)
  const body = await response.json()
  return body.data?.cases || body.cases || []
}

export async function fetchChinaGeoJson({ signal } = {}) {
  const response = await fetch('/maps/china-provinces.json', { signal })
  if (!response.ok) throw new Error(`china geojson request failed: ${response.status}`)
  return response.json()
}
