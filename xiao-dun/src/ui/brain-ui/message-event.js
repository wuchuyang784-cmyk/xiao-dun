const CONTENT_KEYS = ['content', 'text', 'reply', 'response']
const ID_KEYS = ['message_id', 'messageId', 'id', 'conversation_id', 'conversationId']
const SOURCE_KEYS = ['from', 'role', 'sender', 'author', 'source']

function normalizeText(value) {
  if (typeof value !== 'string') return ''
  return value.trim() ? value : ''
}

function nestedObjectValues(data, keys) {
  const values = []
  if (!data || typeof data !== 'object') return values
  for (const key of keys) {
    const value = data[key]
    if (value && typeof value === 'object') values.push(value)
  }
  return values
}

export function extractAssistantMessageContent(data) {
  if (!data || typeof data !== 'object') return ''
  const queue = [data]
  const seen = new Set()
  let depth = 0
  while (queue.length && depth < 3) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    for (const key of CONTENT_KEYS) {
      const text = normalizeText(current[key])
      if (text) return text
    }
    queue.push(...nestedObjectValues(current, ['message', 'payload', 'data', 'output', 'result']))
    depth += 1
  }
  return ''
}

export function resolveAssistantMessageId(data) {
  if (!data || typeof data !== 'object') return ''
  const queue = [data]
  const seen = new Set()
  let depth = 0
  while (queue.length && depth < 3) {
    const current = queue.shift()
    if (!current || typeof current !== 'object' || seen.has(current)) continue
    seen.add(current)
    for (const key of ID_KEYS) {
      const value = current[key]
      if (value !== undefined && value !== null && String(value).trim()) return String(value)
    }
    queue.push(...nestedObjectValues(current, ['message', 'payload', 'data', 'output', 'result']))
    depth += 1
  }
  return ''
}

export function isAssistantMessageEvent(data) {
  if (!data || typeof data !== 'object') return false
  return SOURCE_KEYS
    .map(key => String(data[key] || '').trim().toLowerCase())
    .some(source => source === 'consciousness' || source === 'assistant' || source === 'jarvis' || source === 'agent')
}
