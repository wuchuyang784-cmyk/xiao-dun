const RAG_TOOL_NAME = 'search_fraud_cases'

export function compactToolPayload(payload, options = {}) {
  const maxArrayLength = options.maxArrayLength ?? 10
  const maxStringLength = options.maxStringLength ?? 600
  if (Array.isArray(payload)) {
    return payload.slice(0, maxArrayLength).map(item => compactToolPayload(item, options))
  }
  if (payload && typeof payload === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(payload)) {
      if (typeof v === 'string' && v.length > maxStringLength) {
        const cut = v.slice(0, maxStringLength)
        out[k] = `${cut}…（已截断，原 ${v.length} 字符）`
      } else if (v && typeof v === 'object') {
        out[k] = compactToolPayload(v, options)
      } else {
        out[k] = v
      }
    }
    return out
  }
  return payload
}

function compactRagItem(item, textLimit) {
  const text = String(item?.normalized_text || '')
  return {
    risk_text_id: item?.risk_text_id,
    title: item?.title,
    risk_category_code: item?.risk_category_code,
    risk_category_name: item?.risk_category_name,
    normalized_text: textLimit > 0 && text.length > textLimit
      ? `${text.slice(0, textLimit)}…`
      : textLimit > 0 ? text : undefined,
    similarity_score: item?.similarity_score,
    similarity_level: item?.similarity_level,
    similarity_reason: item?.similarity_reason,
    year: item?.year,
    source_dataset: item?.source_dataset,
  }
}

function compactRagPayload(payload, textLimit) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  return {
    ok: payload?.ok !== false,
    tool: RAG_TOOL_NAME,
    request_id: payload?.request_id,
    knowledge_base_version: payload?.knowledge_base_version,
    embedding_model: payload?.embedding_model,
    reranked: payload?.reranked,
    reliable_match_count: items.length,
    items: items.map(item => compactRagItem(item, textLimit)),
    note: payload?.note,
    ...(payload?.ok === false ? { error: payload?.error, message: payload?.message } : {}),
  }
}

function stringifyRagWithinLimit(payload, maxLength) {
  for (const textLimit of [600, 400, 240, 120, 0]) {
    const serialized = JSON.stringify(compactRagPayload(payload, textLimit))
    if (serialized.length <= maxLength) return serialized
  }
  return JSON.stringify({
    ok: payload?.ok !== false,
    tool: RAG_TOOL_NAME,
    reliable_match_count: Array.isArray(payload?.items) ? payload.items.length : 0,
    truncated: true,
  })
}

function stringifyGenericWithinLimit(payload, maxLength) {
  for (const [maxStringLength, maxArrayLength] of [[600, 10], [300, 8], [160, 5], [80, 3]]) {
    const serialized = JSON.stringify(compactToolPayload(payload, { maxStringLength, maxArrayLength }))
    if (serialized.length <= maxLength) return serialized
  }
  return JSON.stringify({
    ok: payload?.ok !== false,
    tool: payload?.tool,
    message: payload?.message,
    truncated: true,
  })
}

export function formatToolResultForModel(name, result) {
  const raw = String(result ?? '')
  if (name !== RAG_TOOL_NAME) return raw.slice(0, 300)
  try {
    return stringifyRagWithinLimit(JSON.parse(raw), 12_000)
  } catch {
    return raw.slice(0, 300)
  }
}

// Compress tool results into frontend-safe JSON where possible.
// Slicing raw JSON in the middle makes the thought-stream formatter fall back to
// broken plain text, so object payloads are compacted structurally first.
export function truncateToolResultForUI(parsed, raw) {
  if (parsed && typeof parsed === 'object') {
    if (parsed.tool === RAG_TOOL_NAME) return stringifyRagWithinLimit(parsed, 4000)
    return stringifyGenericWithinLimit(parsed, 4000)
  }
  return String(raw ?? '').slice(0, 1000)
}
