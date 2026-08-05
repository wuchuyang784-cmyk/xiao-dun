import { pushMessage } from '../../inbound-message.js'
import { emitEvent } from '../../events.js'
import { getAgentName } from '../agent.js'
import { appendInboundChatMediaMarkdown } from '../inbound-media.js'
import { jsonResponse, readJsonBody } from '../utils.js'
import { execFraudIntel } from '../../capabilities/tools/fraud-intel.js'

// ── 前置拦截：用户说"再推一条反诈提醒"等关键词时，绕开 LLM 直接调
//    fraud_intel push 工具并推微信，避免 LLM 凭自身知识拒绝推送 ──
const FRAUD_PUSH_TRIGGERS = [
  /反诈提醒/i,
  /诈骗提醒/i,
  /反诈情报/i,
  /(再|又|继续|还要|再来|发我|给我)(来|推|发|看|一条|一条反诈|一条诈骗|一条提醒|一个|一个反诈|一个诈骗|一个提醒)/,
  /^(推|来|发|看|要)\s*一?条?\s*(反诈|诈骗|提醒|情报|骗局|案例)/,
  /来\s*一?条\s*(反诈|诈骗|提醒)/,
  /^(推|要|来|发)\s*(反诈|诈骗|提醒|情报|骗局|案例)/,
  /继续推/,
  /推送反诈/,
  /反诈推送/,
]

function looksLikeFraudPushRequest(text) {
  const t = String(text || '').trim()
  if (!t) return false
  // 短句：5 个字以内且包含核心词
  if (t.length <= 8 && /(反诈|诈骗|骗局|提醒|推一条|来一条|推一条|推个|来个)/.test(t)) return true
  return FRAUD_PUSH_TRIGGERS.some(re => re.test(t))
}

const INBOUND_MESSAGE_DEDUPE_TTL_MS = 10_000
const INBOUND_MESSAGE_FALLBACK_DEDUPE_MS = 1_500
const recentInboundMessages = new Map()

function pruneRecentInboundMessages(now = Date.now()) {
  for (const [key, entry] of recentInboundMessages) {
    if (!entry || now - entry.timestamp > INBOUND_MESSAGE_DEDUPE_TTL_MS) {
      recentInboundMessages.delete(key)
    }
  }
}

function normalizeClientMessageId(value = '') {
  const text = String(value || '').trim()
  return /^[a-zA-Z0-9._:-]{8,128}$/.test(text) ? text : ''
}

function claimInboundMessage({ fromId, channel, content, clientMessageId }) {
  const now = Date.now()
  pruneRecentInboundMessages(now)
  const explicitId = normalizeClientMessageId(clientMessageId)
  const key = explicitId
    ? `id:${explicitId}`
    : `body:${JSON.stringify([fromId || '', channel || '', content || ''])}`
  const existing = recentInboundMessages.get(key)
  const ttl = explicitId ? INBOUND_MESSAGE_DEDUPE_TTL_MS : INBOUND_MESSAGE_FALLBACK_DEDUPE_MS
  if (existing && now - existing.timestamp <= ttl) return { claimed: false, key }
  recentInboundMessages.set(key, { timestamp: now })
  return { claimed: true, key }
}

export async function handleMessageRoutes(req, res, url) {
  if (req.method !== 'POST' || url.pathname !== '/message') return false

  let claim = null
  try {
    const body = await readJsonBody(req)
    const { from_id = 'ID:000001', content = '', channel = 'API' } = body
    const trimmed = String(content || '').trim()
    const enhanced = appendInboundChatMediaMarkdown(trimmed, body)
    const queuedContent = enhanced.content
    if (!queuedContent.trim()) {
      jsonResponse(res, 400, { error: 'content or image required' })
      return true
    }
    const clientMessageId = body.client_message_id ?? body.clientMessageId ?? ''
    claim = claimInboundMessage({ fromId: from_id, channel, content: queuedContent, clientMessageId })
    if (!claim.claimed) {
      jsonResponse(res, 200, { ok: true, duplicate: true, agent_name: getAgentName() })
      return true
    }
    const strictEvaluation = body.strict_evaluation ?? body.strictEvaluation
      ?? (String(body.evaluation_mode || body.evaluationMode || '').toLowerCase() === 'strict' ? true : undefined)
    const forbiddenTools = body.forbidden_tools ?? body.forbiddenTools
    const meta = {}
    if (strictEvaluation !== undefined) meta.strictEvaluation = strictEvaluation
    if (Array.isArray(forbiddenTools)) meta.forbiddenTools = forbiddenTools
    if (enhanced.media.length) meta.attachments = enhanced.media
    let queuedContentFinal = queuedContent
    let preExecuted = null
    // 前置拦截：直接调 fraud_intel push 工具并通知 LLM 已执行
    if (looksLikeFraudPushRequest(queuedContent)) {
      try {
        const result = await execFraudIntel({ action: 'push' })
        preExecuted = result
        const notice = `\n\n[系统已执行] fraud_intel push 工具已调用。` +
          (result?.wechat_pushed > 0
            ? `已向 ${result.wechat_pushed} 个微信会话发送反诈提醒。`
            : result?.empty
              ? '当前缓存中没有案例，请稍后或先调 action=fetch 联网采集。'
              : (result?.wechat_total === 0
                ? '微信未绑定，请在脑 UI 扫码绑定微信。'
                : '微信推送未成功，请检查连接状态。')) +
          ` 直接告知用户"已为您推送 N 条反诈提醒到微信"，不要再调工具。`
        queuedContentFinal = queuedContent + notice
      } catch (err) {
        queuedContentFinal = queuedContent + `\n\n[系统已执行] fraud_intel push 调用失败：${err.message}`
      }
    }
    const queued = pushMessage(from_id, queuedContentFinal, channel, meta)
    const conversationId = queued?.conversationId || 0
    emitEvent('message_in', { from_id, content: queuedContentFinal, channel, timestamp: new Date().toISOString(), conversation_id: conversationId, attachments: enhanced.media })
    jsonResponse(res, 200, { ok: true, agent_name: getAgentName(), conversation_id: conversationId, attachments: enhanced.media, pre_executed: preExecuted ? { wechat_pushed: preExecuted.wechat_pushed, wechat_total: preExecuted.wechat_total, push_count: preExecuted.push_count, empty: !!preExecuted.empty } : null })
  } catch (e) {
    if (claim?.claimed && claim.key) recentInboundMessages.delete(claim.key)
    jsonResponse(res, 400, { error: e.message })
  }
  return true
}
