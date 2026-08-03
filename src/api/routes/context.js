// 上下文管理路由：压缩对话历史 + 报告 token 预估
import { jsonResponse } from '../utils.js'
import { getDB } from '../../db.js'
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

/**
 * 触发上下文压缩：保留最近 N 条，删除更早的（不依赖外部 LLM）
 */
function compressContext({ keepRecent = 8 } = {}) {
  const db = getDB()
  const all = db.prepare(`
    SELECT id, role, from_id, content, timestamp
    FROM conversations
    ORDER BY id DESC
    LIMIT 200
  `).all()
  if (all.length <= keepRecent) {
    return { compressed: false, reason: '消息数过少，无需压缩', before: all.length, after: all.length }
  }

  // all 已按 id DESC 排序；时间从早到晚要 ASC
  const asc = all.slice().reverse()
  const splitIdx = Math.max(0, asc.length - keepRecent)
  const toRemove = asc.slice(0, splitIdx)
  if (toRemove.length === 0) {
    return { compressed: false, reason: '没有可压缩的旧消息', before: all.length, after: all.length }
  }

  const removeStmt = db.prepare('DELETE FROM conversations WHERE id = ?')
  let removed = 0
  db.transaction(() => {
    for (const row of toRemove) {
      removeStmt.run(row.id)
      removed++
    }
  })()

  return {
    compressed: true,
    before: all.length,
    after: all.length - removed,
    removed,
  }
}

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