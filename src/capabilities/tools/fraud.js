import { searchRiskTexts } from '../../services/rag-client.js'

export async function execSearchFraudCases(args = {}) {
  try {
    const data = await searchRiskTexts({
      queryText: args.query_text || args.queryText,
      topK: args.top_k ?? args.topK,
      candidateK: args.candidate_k ?? args.candidateK,
      riskCategoryHint: args.risk_category_hint || args.riskCategoryHint,
    })
    return JSON.stringify({
      ok: true,
      tool: 'search_fraud_cases',
      ...data,
      note: 'These are semantic reference texts from the published anti-fraud knowledge base, not real-time incident counts or geographic prevalence.',
    })
  } catch (error) {
    return JSON.stringify({
      ok: false,
      tool: 'search_fraud_cases',
      error: error?.code || 'RAG_ERROR',
      message: error?.message || 'anti-fraud knowledge search failed',
    })
  }
}
