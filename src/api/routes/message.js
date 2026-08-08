import { pushMessage } from '../../inbound-message.js'
import { emitEvent } from '../../events.js'
import { getAgentName } from '../agent.js'
import { appendInboundChatMediaMarkdown } from '../inbound-media.js'
import { jsonResponse, readJsonBody } from '../utils.js'
import { execFraudIntel } from '../../capabilities/tools/fraud-intel.js'
import { execScheduledReminder } from '../../capabilities/tools/scheduled-reminder.js'

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
  // 斜杠命令优先交给子命令拦截处理（避免 /定时提醒 /诈骗情报 误触发推送）
  if (t.startsWith('/')) return false
  // 短句：5 个字以内且包含核心词
  if (t.length <= 8 && /(反诈|诈骗|骗局|提醒|推一条|来一条|推一条|推个|来个)/.test(t)) return true
  return FRAUD_PUSH_TRIGGERS.some(re => re.test(t))
}

// ── /定时提醒 子命令拦截 ────────────────────────────────────────────
// 解析 `/定时提醒` 及其变体，支持 status / enable / disable / set_time HH:MM / set_interval N / history
const SCHEDULED_REMINDER_SUBCOMMAND_RE =
  /^\/?(定时提醒|scheduled_reminder|scheduled-reminder)(?:[\s,，]+(开启|打开|启用|启用定时|开|启|on|开启定时|on$)|[\s,，]+(关闭|关|停|停止|禁用|off)|[\s,，]+(状态|config|配置|查看)|[\s,，]+(时间|每日时间|每日定时|set_time|time)[\s,，:：]*([0-2]?\d:[0-5]\d)?|[\s,，]+(间隔|set_interval|interval|每)[\s,，:：]*(\d{1,2})?(小时|h|hour)?|[\s,，]+(历史|记录|history))?\s*$/i
const SCHEDULED_REMINDER_BARE_RE = /^\/?(定时提醒|scheduled_reminder|scheduled-reminder)\s*$/i

function parseScheduledReminderSubcommand(text) {
  const t = String(text || '').trim()
  if (!t) return null
  const m = t.match(SCHEDULED_REMINDER_SUBCOMMAND_RE)
  if (m) {
    if (m[2]) return { action: 'enable', raw: t }
    if (m[3]) return { action: 'disable', raw: t }
    if (m[4]) return { action: 'status', raw: t }
    if (m[5]) return { action: 'set_time', time: m[6] || '', raw: t }
    if (m[7]) return { action: 'set_interval', interval_hours: parseInt(m[8] || '12', 10), raw: t }
    if (m[9]) return { action: 'history', raw: t }
  }
  if (t.match(SCHEDULED_REMINDER_BARE_RE)) {
    return { action: 'status', raw: t }
  }
  return null
}

// 工具返回 JSON 字符串，这里解析为对象（失败时安全降级为空对象）
function parseToolResult(raw) {
  if (typeof raw !== 'string') return raw || {}
  try { return JSON.parse(raw) } catch { return {} }
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
    // ── /定时提醒 子命令拦截：直接调 scheduled_reminder 工具并推结果给用户 ──
    const reminderSub = parseScheduledReminderSubcommand(queuedContent)
    if (reminderSub) {
      try {
        const argObj = { action: reminderSub.action }
        if (reminderSub.action === 'set_time') {
          let tm = reminderSub.time
          if (!tm) {
            const lm = queuedContent.match(/(\d{1,2})\s*[:点时](\d{0,2})/i)
            if (lm) {
              const h = String(Math.min(23, parseInt(lm[1] || '0', 10))).padStart(2, '0')
              const m2 = String(Math.min(59, parseInt(lm[2] || '0', 10))).padStart(2, '0')
              tm = `${h}:${m2}`
            }
          }
          if (tm) argObj.time = tm
        } else if (reminderSub.action === 'set_interval') {
          argObj.interval_hours = reminderSub.interval_hours
        }
        const raw = await execScheduledReminder(argObj)
        const result = parseToolResult(raw)
        preExecuted = result
        emitEvent('message', {
          from: 'consciousness',
          to: from_id,
          content: result?.text || JSON.stringify(result),
          timestamp: new Date().toISOString(),
          channel: 'scheduled_reminder',
          source: 'scheduled_reminder_subcommand',
        })
        jsonResponse(res, 200, {
          ok: true,
          agent_name: getAgentName(),
          handled_by: 'scheduled_reminder_subcommand',
          pre_executed: result,
        })
        return true
      } catch (err) {
        emitEvent('message', {
          from: 'consciousness',
          to: from_id,
          content: '【定时提醒】调用失败：' + err.message,
          timestamp: new Date().toISOString(),
          channel: 'scheduled_reminder',
          source: 'scheduled_reminder_subcommand',
        })
        jsonResponse(res, 200, {
          ok: true,
          agent_name: getAgentName(),
          handled_by: 'scheduled_reminder_subcommand',
          error: err.message,
        })
        return true
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
