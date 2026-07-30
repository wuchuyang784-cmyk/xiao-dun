// Shared prompt-formatting helpers for memory injection.
// This module intentionally contains presentation helpers only; it does not
// implement graph traversal or any desktop-only capability.

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback
  return String(value).trim()
}

function escapeAttribute(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function shortTimestamp(value) {
  const raw = text(value)
  if (!raw) return ''
  const match = raw.match(/(?:T|\s)(\d{2}:\d{2})/)
  return match ? match[1] : raw.slice(0, 19)
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(item => text(item)).filter(Boolean)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return normalizeTags(parsed)
    } catch {
      // Fall through to the simple comma-separated representation.
    }
    return value.split(/[,?]/).map(item => item.trim()).filter(Boolean)
  }
  return []
}

function cleanTitle(value) {
  return text(value).replace(/^\s*\[[^\]]+\]\s*/, '')
}

function memoryLine(memory, index = 0) {
  const item = memory || {}
  const id = text(item.mem_id || item.id || `memory-${index + 1}`)
  const kind = text(item.event_type || item.type || item.kind || 'memory')
  const title = cleanTitle(item.title || item.topic || '')
  const content = text(item.content || item.detail || item.summary || '')
  const timestamp = shortTimestamp(item.timestamp || item.created_at || item.createdAt)
  const salience = Number(item.salience)
  const marker = Number.isFinite(salience) && salience >= 4 ? ' ?' : ''
  const tags = normalizeTags(item.tags)
  const meta = [
    `id="${escapeAttribute(id)}"`,
    `kind=${escapeAttribute(kind)}`,
    timestamp ? `time=${escapeAttribute(timestamp)}` : '',
    tags.length ? `tags=${escapeAttribute(tags.join(','))}` : '',
  ].filter(Boolean).join(' ')
  const heading = title ? `[${title}]` : `[${kind}]`
  const body = content.slice(0, 1200)
  return `- ${heading}${marker} <${meta}>${body ? ` ${body}` : ''}`
}

export function formatMemoriesForPrompt(memories, recallMemories) {
  const primary = asArray(memories)
  const recall = asArray(recallMemories)
  const all = [...primary, ...recall]
  const seen = new Set()
  const lines = []
  for (const [index, memory] of all.entries()) {
    const key = text(memory?.mem_id || memory?.id) || `${memory?.timestamp || ''}:${memory?.content || ''}`
    if (seen.has(key)) continue
    seen.add(key)
    lines.push(memoryLine(memory, index))
  }
  return lines.join('\n')
}

export function formatTemporalRecall(groups) {
  const items = asArray(groups).filter(group => asArray(group?.memories).length > 0)
  if (!items.length) return ''
  const sections = []
  for (const group of items) {
    const date = escapeAttribute(group.date || '')
    const label = escapeAttribute(group.label || group.date || '')
    const lines = asArray(group.memories).map((memory, index) => memoryLine(memory, index))
    sections.push(`<day date="${date}" label="${label}">\n${lines.join('\n')}\n</day>`)
  }
  return `<temporal-recall>\n${sections.join('\n')}\n</temporal-recall>`
}

export function formatTaskKnowledge(items) {
  const entries = asArray(items)
  if (!entries.length) return ''
  return entries.map((item, index) => {
    const title = cleanTitle(item?.title || item?.topic || item?.name || `artifact-${index + 1}`)
    const content = text(item?.content || item?.detail || item?.summary || item?.body)
    const status = text(item?.status || item?.state)
    return `- [${title}]${status ? ` (${status})` : ''}${content ? ` ${content.slice(0, 1000)}` : ''}`
  }).join('\n')
}

export function formatPrefetchedItems(items) {
  const entries = asArray(items)
  if (!entries.length) return ''
  const lines = entries.map((item, index) => {
    const source = text(item?.source || item?.provider || item?.kind || 'prefetch')
    const title = cleanTitle(item?.title || item?.name || `item-${index + 1}`)
    const content = text(item?.content || item?.summary || item?.text || item?.value)
    return `- [${title}] source=${source}${content ? ` ${content.slice(0, 800)}` : ''}`
  })
  return `<prefetched-items>\n${lines.join('\n')}\n</prefetched-items>`
}

export function formatSceneManifest(manifest) {
  const entries = asArray(manifest)
  if (!entries.length) return ''
  const lines = entries.map(item => {
    const id = escapeAttribute(item?.id || 'unknown')
    const kind = escapeAttribute(item?.kind || 'surface')
    const flags = [item?.focus ? 'focus' : '', item?.intent && item.intent !== 'inform' ? text(item.intent) : '']
      .filter(Boolean)
      .join(',')
    return `- id="${id}" kind=${kind}${flags ? ` [${escapeAttribute(flags)}]` : ''}`
  })
  return `[Surfaces currently on screen]\n${lines.join('\n')}\nUse ui_set to update a surface; this manifest is context, not a trigger.`
}

export function summarizeUISignals(signals) {
  const entries = asArray(signals)
  if (!entries.length) return ''
  const lines = entries.map(signal => {
    const kind = text(signal?.kind || signal?.type || 'ui')
    const value = text(signal?.text || signal?.message || signal?.value || signal?.id)
    return `- ${kind}${value ? `: ${value.slice(0, 600)}` : ''}`
  })
  return `<ui-signals>\n${lines.join('\n')}\n</ui-signals>`
}
