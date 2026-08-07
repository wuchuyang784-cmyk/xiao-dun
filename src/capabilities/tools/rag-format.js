export function normalizeRagCase(item = {}, index = 0) {
  const similarity = typeof item.similarity_score === 'number' ? item.similarity_score
    : typeof item.score === 'number' ? item.score
      : typeof item.similarity === 'number' ? item.similarity
        : typeof item.distance === 'number' ? 1 - item.distance
          : null

  const category = item.risk_category_name || item.category || item.category_name
    || item.category_code || item.risk_category || item.risk_category_code || ''

  const snippet = String(item.normalized_text || item.text || item.snippet || '').slice(0, 240)

  return {
    rank: index + 1,
    id: item.risk_text_id || item.case_id || item.id || '',
    title: item.title || item.risk_text_title || snippet.slice(0, 60) || '(\u672a\u547d\u540d\u6848\u4f8b)',
    category,
    categoryCode: item.risk_category_code || item.category_code || '',
    similarity,
    similarityLevel: item.similarity_level || '',
    reason: item.similarity_reason || '',
    snippet,
    year: item.year || null,
    sourceDataset: item.source_dataset || item.source || '',
  }
}

export function normalizeRagCases(items = []) {
  return Array.isArray(items) ? items.map(normalizeRagCase) : []
}
