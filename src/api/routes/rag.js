import { API_PATHS } from '../../services/api-contract.ts'
import { addRiskText, getRagMapStats, getRagReadiness, searchRiskTexts } from '../../services/rag-client.js'
import { jsonResponse, readJsonBody } from '../utils.js'

export async function handleRagRoutes(req, res, url, {
  search = searchRiskTexts,
  getMapStats = getRagMapStats,
  getReadiness = getRagReadiness,
  addItem = addRiskText,
} = {}) {
  if (req.method === 'POST' && url.pathname === API_PATHS.fraud.rag.activate) {
    try {
      const data = await getReadiness()
      if (!data.ready) {
        jsonResponse(res, 503, {
          code: 'RAG_NOT_READY',
          message: `RAG knowledge base is incomplete (${data.vectorCount}/${data.expectedCount})`,
          data,
        })
        return true
      }
      jsonResponse(res, 200, { code: 0, message: 'success', data })
    } catch (error) {
      jsonResponse(res, error?.statusCode || 503, {
        code: error?.code || 'RAG_ACTIVATION_FAILED',
        message: error?.message || 'RAG knowledge base is unavailable',
        data: null,
      })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === API_PATHS.fraud.rag.items) {
    try {
      const input = await readJsonBody(req, { maxBytes: 64 * 1024 })
      const data = await addItem({
        title: input.title,
        text: input.text,
        categoryCode: input.categoryCode || input.category_code,
        riskSignals: input.riskSignals || input.risk_signals,
        keyPhrases: input.keyPhrases || input.key_phrases,
        year: input.year,
        sourceDataset: input.sourceDataset || input.source_dataset,
        piiConfirmed: input.piiConfirmed === true || input.pii_confirmed === true,
      })
      jsonResponse(res, 201, { code: 0, message: 'success', data, request_id: data.requestId })
    } catch (error) {
      jsonResponse(res, error?.statusCode || 503, {
        code: error?.code || 'RAG_ITEM_CREATE_FAILED',
        message: error?.message || 'failed to add RAG item',
        data: null,
      })
    }
    return true
  }

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
