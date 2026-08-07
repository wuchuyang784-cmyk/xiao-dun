import crypto from 'node:crypto'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8001'
// The first local model load can take about 20 seconds; keep the default above
// that cold-start window while allowing an environment override.
const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_KNOWLEDGE_BASE_VERSION = 'kb_chifraud_competition_v1'

const PROVINCE_NAMES = Object.freeze({
  '110000': '北京市', '120000': '天津市', '130000': '河北省', '140000': '山西省',
  '150000': '内蒙古自治区', '210000': '辽宁省', '220000': '吉林省', '230000': '黑龙江省',
  '310000': '上海市', '320000': '江苏省', '330000': '浙江省', '340000': '安徽省',
  '350000': '福建省', '360000': '江西省', '370000': '山东省', '410000': '河南省',
  '420000': '湖北省', '430000': '湖南省', '440000': '广东省', '450000': '广西壮族自治区',
  '460000': '海南省', '500000': '重庆市', '510000': '四川省', '520000': '贵州省',
  '530000': '云南省', '540000': '西藏自治区', '610000': '陕西省', '620000': '甘肃省',
  '630000': '青海省', '640000': '宁夏回族自治区', '650000': '新疆维吾尔自治区',
  '710000': '台湾省', '810000': '香港特别行政区', '820000': '澳门特别行政区',
})

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function normalizeBaseUrl(value) {
  const raw = String(value || DEFAULT_BASE_URL).trim().replace(/\/+$/, '')
  let parsed
  try {
    parsed = new URL(raw)
  } catch {
    throw new RagServiceError('RAG base URL is invalid', {
      code: 'INVALID_RAG_CONFIG',
      statusCode: 500,
    })
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new RagServiceError('RAG base URL must use http or https', {
      code: 'INVALID_RAG_CONFIG',
      statusCode: 500,
    })
  }
  return raw
}

export class RagServiceError extends Error {
  constructor(message, { code = 'RAG_ERROR', statusCode = 503, cause } = {}) {
    super(message, { cause })
    this.name = 'RagServiceError'
    this.code = code
    this.statusCode = statusCode
  }
}

export function getRagConfig(env = process.env) {
  return {
    baseUrl: normalizeBaseUrl(env.XIAODUN_RAG_BASE_URL || env.RAG_BASE_URL),
    timeoutMs: boundedInteger(
      env.XIAODUN_RAG_TIMEOUT_MS || env.RAG_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      1_000,
      120_000,
    ),
    knowledgeBaseVersion: String(
      env.XIAODUN_RAG_KNOWLEDGE_BASE_VERSION
      || env.RAG_KNOWLEDGE_BASE_VERSION
      || DEFAULT_KNOWLEDGE_BASE_VERSION,
    ).trim(),
  }
}

function normalizeQuery(value) {
  const queryText = String(value || '').trim()
  if (!queryText || queryText.length > 8_000) {
    throw new RagServiceError('queryText must contain between 1 and 8000 characters', {
      code: 'INVALID_RAG_QUERY',
      statusCode: 400,
    })
  }
  return queryText
}

async function readResponseJson(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (cause) {
    throw new RagServiceError('RAG service returned invalid JSON', {
      code: 'INVALID_RAG_RESPONSE',
      statusCode: 502,
      cause,
    })
  }
}

export async function searchRiskTexts(input = {}, options = {}) {
  const queryText = normalizeQuery(input.queryText ?? input.query_text)
  const config = options.config || getRagConfig()
  const fetchImpl = options.fetchImpl || globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    throw new RagServiceError('fetch is unavailable', { code: 'RAG_UNAVAILABLE' })
  }

  const topK = boundedInteger(input.topK ?? input.top_k, 5, 1, 20)
  const candidateK = Math.max(
    topK,
    boundedInteger(input.candidateK ?? input.candidate_k, 50, 1, 100),
  )
  const requestId = String(input.requestId || input.request_id || crypto.randomUUID()).trim()
  const knowledgeBaseVersion = String(
    input.knowledgeBaseVersion
    || input.knowledge_base_version
    || config.knowledgeBaseVersion
    || '',
  ).trim()
  const riskCategoryHint = String(input.riskCategoryHint || input.risk_category_hint || '').trim()
  const body = {
    request_id: requestId,
    query_text: queryText,
    top_k: topK,
    candidate_k: candidateK,
    ...(riskCategoryHint ? { risk_category_hint: riskCategoryHint } : {}),
    ...(knowledgeBaseVersion ? { knowledge_base_version: knowledgeBaseVersion } : {}),
  }

  let response
  try {
    response = await fetchImpl(`${normalizeBaseUrl(config.baseUrl)}/internal/v1/rag/search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-Request-ID': requestId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(boundedInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000)),
    })
  } catch (cause) {
    throw new RagServiceError(
      cause?.name === 'TimeoutError' ? 'RAG service request timed out' : 'RAG service is unavailable',
      { code: 'RAG_UNAVAILABLE', statusCode: 503, cause },
    )
  }

  const envelope = await readResponseJson(response)
  if (!response.ok || envelope?.code !== 0) {
    throw new RagServiceError(String(envelope?.message || `RAG service returned HTTP ${response.status}`).slice(0, 500), {
      code: 'RAG_UPSTREAM_ERROR',
      statusCode: response.status >= 500 ? 503 : 502,
    })
  }
  if (!envelope?.data || !Array.isArray(envelope.data.items)) {
    throw new RagServiceError('RAG service response is missing data.items', {
      code: 'INVALID_RAG_RESPONSE',
      statusCode: 502,
    })
  }

  return {
    ...envelope.data,
    request_id: envelope.request_id || requestId,
  }
}

export async function getRagHealth(options = {}) {
  const config = options.config || getRagConfig()
  const fetchImpl = options.fetchImpl || globalThis.fetch
  try {
    const response = await fetchImpl(`${normalizeBaseUrl(config.baseUrl)}/internal/v1/ai/health`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(boundedInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000)),
    })
    const envelope = await readResponseJson(response)
    return {
      ok: response.ok && envelope?.code === 0 && envelope?.data?.status === 'ok',
      status: envelope?.data?.status || 'unknown',
    }
  } catch {
    return { ok: false, status: 'unavailable' }
  }
}

export async function getRagMapStats(options = {}) {
  const config = options.config || getRagConfig()
  const fetchImpl = options.fetchImpl || globalThis.fetch
  let response
  try {
    response = await fetchImpl(`${normalizeBaseUrl(config.baseUrl)}/internal/v1/rag/map-stats`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(boundedInteger(config.timeoutMs, DEFAULT_TIMEOUT_MS, 1_000, 120_000)),
    })
  } catch (cause) {
    throw new RagServiceError('RAG map statistics are unavailable', {
      code: 'RAG_UNAVAILABLE',
      statusCode: 503,
      cause,
    })
  }

  const envelope = await readResponseJson(response)
  if (!response.ok || envelope?.code !== 0 || !Array.isArray(envelope?.data?.provinces)) {
    throw new RagServiceError(String(envelope?.message || 'RAG map statistics returned an invalid response').slice(0, 500), {
      code: 'RAG_MAP_UPSTREAM_ERROR',
      statusCode: 503,
    })
  }

  const data = envelope.data
  return {
    type: 'fraud_statistics_snapshot',
    version: 1,
    generatedAt: new Date().toISOString(),
    source: 'rag_simulation',
    isSimulated: true,
    simulationVersion: String(data.simulation_version || 'competition_demo_v1'),
    knowledgeBaseVersion: config.knowledgeBaseVersion,
    dataSource: String(data.data_source || 'ChiFraud'),
    totalSamples: Number(data.total_samples || 0),
    disclaimer: '比赛模拟数据，仅用于可视化展示，不代表真实案件发生率或地区风险。',
    provinces: data.provinces.map((row) => {
      const provinceCode = String(row.province_code || '')
      const sampleCount = Number(row.sample_count || 0)
      return {
        provinceCode,
        provinceName: PROVINCE_NAMES[provinceCode] || String(row.province_name || provinceCode),
        sampleCount,
        caseCount: sampleCount,
        highRiskCount: 0,
        pendingCount: 0,
        totalLossAmount: 0,
        isSimulated: true,
      }
    }),
  }
}
