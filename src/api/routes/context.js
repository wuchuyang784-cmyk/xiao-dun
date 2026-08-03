// 上下文管理路由：提取对话摘要存入记忆 + 预估 token
import { jsonResponse } from '../utils.js'
import { getDB, upsertMemoryByMemId } from '../../db.js'
import { estimateTokens } from '../../memory/context-compress.js'

const DEFAULT_LIMIT = 200

/**
 * 估算当前对话上下文的 token 数
 */
function estimateContextUsage(limit = DEFAULT_LIMIT) {
  const db = getDB()
  const rows = db.prepare(`
    SELECT id, role, from_id, content, timestamp
    FROM conversations
    ORDER BY id DESC
    LIMIT ?
  `).all(limit)
  let total = 0
  let lastTs = null
  for (const row of rows) {
    total += estimateTokens(row.content || '')
    if (!lastTs || (row.timestamp && row.timestamp > lastTs)) lastTs = row.timestamp
  }
  return {
    messageCount: rows.length,
    estimatedTokens: total,
    lastTimestamp: lastTs,
  }
}

// ============ 本地摘要引擎 ============

/**
 * 提取对话中的关键信息：
 * - 说话角色统计
 * - 高频关键词（中文 2-4 字词组）
 * - 话题变迁时间线
 * - 时间范围
 */
function extractConversationEssence(messages) {
  const roles = {}
  const keywords = new Map()
  const topics = []
  let firstTs = '', lastTs = ''

  for (const m of messages) {
    // 角色统计
    const role = m.role || 'unknown'
    roles[role] = (roles[role] || 0) + 1

    // 高频中文关键词（2-4 字）
    const text = m.content || ''
    const cjkWords = text.match(/[\u4e00-\u9fff]{2,4}/g) || []
    for (const w of cjkWords) {
      if (/^(所以|但是|因为|虽然|不过|而且|然后|可以|这个|那个|我们|他们|什么|怎么|为什么)$/.test(w)) continue
      keywords.set(w, (keywords.get(w) || 0) + 1)
    }

    // 时间戳
    if (m.timestamp) {
      if (!firstTs || m.timestamp < firstTs) firstTs = m.timestamp
      if (!lastTs || m.timestamp > lastTs) lastTs = m.timestamp
    }
  }

  // 排序关键词取 top-8
  const topWords = [...keywords.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([w]) => w)

  return {
    roles,
    topWords,
    timeRange: firstTs && lastTs ? `${String(firstTs).slice(0, 10)} ~ ${String(lastTs).slice(0, 10)}` : '',
    messageCount: messages.length,
  }
}

/**
 * 生成人类可读的摘要段落
 */
function buildSummaryText(essence) {
  const parts = []
  parts.push(`对话时间：${essence.timeRange || '未知'}`)
  parts.push(`共 ${essence.messageCount} 条消息`)

  const roleParts = Object.entries(essence.roles)
    .map(([r, n]) => `${r}(${n}条)`)
  if (roleParts.length > 0) parts.push(`发言统计：${roleParts.join('、')}`)

  if (essence.topWords.length > 0) {
    parts.push(`涉及话题：${essence.topWords.join('、')}`)
  }

  return parts.join('；') + '。'
}

/**
 * 提取对话摘要，存入短期记忆，删除旧原始消息
 */
function compressContext({ keepRecent = 8 } = {}) {
  const db = getDB()
  const all = db.prepare(`
    SELECT id, role, from_id, content, timestamp
    FROM conversations
    ORDER BY id DESC
    LIMIT 300
  `).all()
  if (all.length <= keepRecent) {
    return { compressed: false, reason: '消息数过少，无需压缩', before: all.length, after: all.length }
  }

  // 按时间 ASC
  const asc = all.slice().reverse()
  const splitIdx = Math.max(0, asc.length - keepRecent)
  const older = asc.slice(0, splitIdx)
  if (older.length === 0) {
    return { compressed: false, reason: '没有可压缩的旧消息', before: all.length, after: all.length }
  }

  // 1. 提取摘要
  const essence = extractConversationEssence(older)
  const summary = buildSummaryText(essence)
  const summaryTitle = `对话摘要 ${essence.timeRange || ''}`.trim()

  // 2. 存入短期记忆（mem_id 唯一，后续检索自动被 memory/injector 注入上下文）
  const memId = `ctx-summary-${Date.now()}`
  upsertMemoryByMemId({
    mem_id: memId,
    source: 'context_compression',
    scope: 'short_term',
    content: summary,
    salience: 0.3, // 低紧迫但高相关性
    meta: JSON.stringify({
      type: 'conversation_summary',
      title: summaryTitle,
      compressed_count: older.length,
      time_range: essence.timeRange,
      top_words: essence.topWords,
    }),
    timestamp: new Date().toISOString(),
  })

  // 3. 删除旧原始消息
  const removeStmt = db.prepare('DELETE FROM conversations WHERE id = ?')
  let removed = 0
  db.transaction(() => {
    for (const row of older) {
      removeStmt.run(row.id)
      removed++
    }
  })()

  return {
    compressed: true,
    before: all.length,
    after: all.length - removed,
    removed,
    summary_chars: summary.length,
    summary_title: summaryTitle,
    summary_preview: summary.slice(0, 100),
    mem_id: memId,
  }
}

// ============ HTTP 路由 ============

function readJsonBody(req) {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

export async function handleContextRoutes(req, res, url) {
  if (url.pathname === '/api/v1/context/stats' && req.method === 'GET') {
    const usage = estimateContextUsage()
    jsonResponse(res, 200, { code: 0, message: 'success', data: usage })
    return true
  }
  if (url.pathname === '/api/v1/context/compress' && req.method === 'POST') {
    const body = await readJsonBody(req)
    const result = compressContext({
      keepRecent: Math.max(2, Math.min(50, Number(body?.keep_recent) || 8)),
    })
    jsonResponse(res, 200, { code: 0, message: 'success', data: result })
    return true
  }
  return false
}