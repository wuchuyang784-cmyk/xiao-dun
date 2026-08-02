import { API_PATHS } from '../../services/api-contract.ts'
import { getRagMapStats, searchRiskTexts } from '../../services/rag-client.js'
import { jsonResponse, readJsonBody } from '../utils.js'

export async function handleRagRoutes(req, res, url, {
  search = searchRiskTexts,
  getMapStats = getRagMapStats,
} = {}) {
  if (req.method === 'GET' && url.pathname === API_PATHS.fraud.statistics.provinces) {
    try {
      const data = await getMapStats()
      jsonResponse(res, 200, { code: 0, message: 'success', data })
      return true
    } catch (error) {
      jsonResponse(res, error?.statusCode || 503, {
        code: error?.code || 'RAG_MAP_STATS_FAILED',
        message: error?.message || 'anti-fraud statistics are unavailable',
        data: null,
      })
      return true
    }
  }

  if (req.method !== 'POST' || url.pathname !== API_PATHS.fraud.cases.search) return false

  try {
    const input = await readJsonBody(req, { maxBytes: 64 * 1024 })
    const data = await search({
      queryText: input.queryText || input.query_text,
      topK: input.topK ?? input.top_k,
      candidateK: input.candidateK ?? input.candidate_k,
      riskCategoryHint: input.riskCategoryHint || input.risk_category_hint,
    })
    jsonResponse(res, 200, {
      code: 0,
      message: 'success',
      data,
      request_id: data.request_id,
    })
  } catch (error) {
    jsonResponse(res, error?.statusCode || 503, {
      code: error?.code || 'RAG_SEARCH_FAILED',
      message: error?.message || 'anti-fraud knowledge search failed',
      data: null,
    })
  }
  return true
}
