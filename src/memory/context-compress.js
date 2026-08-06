// 上下文压缩：防止 conversationWindow 过大导致 LLM 超出有效上下文窗口
//
// 策略：
//   - 最近 KEEP_FULL 条（默认 8）保留完整原文
//   - 再往前的按批压缩为摘要占位符
//   - 超过 HARD_LIMIT 条的硬截断

const KEEP_FULL = 8
const HARD_LIMIT = 24

/**
 * 估计文本的近似 token 数（按 1 中文字符 ≈ 1.5 token，1 英文词 ≈ 1.3 token）
 */
export function estimateTokens(text) {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length
  const words = (text.match(/[a-zA-Z]+/g) || []).length
  return Math.ceil(cjk * 1.5 + words * 1.3 + text.length * 0.6)
}

/**
 * 压缩对话窗口
 * @param {Array} window - conversationWindow 数组 [{ role, content, timestamp, ... }]
 * @returns {{ compressed: Array, summary: string|null }}
 */
export function compressConversationWindow(window) {
  if (!Array.isArray(window) || window.length <= KEEP_FULL) {
    return { compressed: window || [], summary: null }
  }

  const compressed = []
  const older = []

  for (let i = 0; i < window.length; i++) {
    if (i < window.length - KEEP_FULL) {
      older.push(window[i])
    } else {
      // 硬截断
      if (compressed.length < HARD_LIMIT) {
        compressed.push(window[i])
      }
    }
  }

  // 为压缩掉的消息生成摘要
  if (older.length === 0) {
    return { compressed, summary: null }
  }

  const talkers = new Map()
  for (const row of older) {
    const role = row.role || 'unknown'
    talkers.set(role, (talkers.get(role) || 0) + 1)
  }
  const talkerSummary = [...talkers.entries()]
    .map(([role, count]) => `${role} × ${count}`)
    .join('、')

  const first = older[0]
  const last = older[older.length - 1]
  const timeRange = first?.timestamp && last?.timestamp
    ? `${first.timestamp.slice(0, 10)} → ${last.timestamp.slice(0, 10)}`
    : ''

  const summary = `[Summarized ${older.length} earlier messages (${talkerSummary})${timeRange ? ' from ' + timeRange : ''}. Context has been trimmed to focus on the recent conversation.]`

  return { compressed, summary }
}

/**
 * 预估整个 LLM prompt 的 token 数
 */
export function estimatePromptTokens({ systemPrompt = '', contextBlock = '', compressedWindow = [] } = {}) {
  let total = 0
  total += estimateTokens(systemPrompt)
  total += estimateTokens(contextBlock)
  for (const row of compressedWindow) {
    total += estimateTokens(row.content || '')
  }
  return total
}

/**
 * 判断是否需要进一步压缩（超过阈值）
 */
export function needsMoreCompression({ tokenEstimate, threshold = 16000 } = {}) {
  return tokenEstimate > threshold
}
