import { pushMessage } from '../../inbound-message.js'
import { emitEvent } from '../../events.js'
import { getAgentName } from '../agent.js'
import { appendInboundChatMediaMarkdown } from '../inbound-media.js'
import { jsonResponse, readJsonBody } from '../utils.js'
import { execFraudIntel } from '../../capabilities/tools/fraud-intel.js'
import { getFraudIntelCache, collectFraudIntel } from '../../fraud-intel.js'
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
  // 斜杠命令优先交给 subcommand 拦截处理（避免 /诈骗情报 误触发推送）
  if (t.startsWith('/')) return false
  // 短句：5 个字以内且包含核心词
  if (t.length <= 8 && /(反诈|诈骗|骗局|提醒|推一条|来一条|推一条|推个|来个)/.test(t)) return true
  return FRAUD_PUSH_TRIGGERS.some(re => re.test(t))
}

// ── 子命令拦截：`/诈骗情报 采集|列表|推送|搜索 xxx` 直接调工具绕开 LLM ──
// 与 FRAUD_PUSH_TRIGGERS 互补：这条管斜杠命令精确格式；那条管自然语言模糊请求。
const FRAUD_INTEL_SUBCOMMAND_RE = /^\/?(诈骗情报|fraud_intel|fraud-intel)[\s,，]+(采集|刷新|列表|查看|推送|发给我|搜索|查一下|找一下|搜一下|查)(?:[\s,，]+(.+))?$/i
const FRAUD_INTEL_BARE_RE = /^\/?(诈骗情报|fraud_intel|fraud-intel)\s*$/i

function parseFraudIntelSubcommand(text) {
  const t = String(text || '').trim()
  let m = t.match(FRAUD_INTEL_SUBCOMMAND_RE)
  if (m) {
    const sub = m[2].toLowerCase()
    const rest = (m[3] || '').trim()
    if (/^(采集|刷新)$/.test(sub)) return { action: 'fetch', force: true, raw: t }
    if (/^(列表|查看)$/.test(sub)) return { action: 'list', raw: t }
    if (/^(推送|发给我)$/.test(sub)) return { action: 'push', raw: t }
    if (/^(搜索|查一下|找一下|搜一下|查)$/.test(sub)) {
      return { action: 'search', keyword: rest, raw: t }
    }
  }
  m = t.match(FRAUD_INTEL_BARE_RE)
  if (m) return { action: '__auto__', raw: t } // 触发自动 fetch + 让 LLM 总结
  return null
}

const FRAUD_CATEGORY_KEYWORDS = {
  brushing: ['刷单', '返利', '刷单返利'],
  refund_customer: ['冒充客服', '退款', '理赔'],
  impersonate_police: ['冒充公检法', '公检法', '通缉令', '安全账户'],
  fake_investment: ['虚假投资', '投资理财', '股票群', '数字货币', '杀猪盘'],
  pig_butchering: ['杀猪盘', '婚恋', '网恋', '杀猪'],
  loan_scam: ['贷款诈骗', '贷款', '免息', '低息贷款'],
  prize_scam: ['中奖', '彩票', '抽奖'],
  nude_extortion: ['裸聊', '敲诈', '视频'],
}

function categoriesFromKeyword(text) {
  const out = []
  const t = String(text || '').toLowerCase()
  for (const [id, words] of Object.entries(FRAUD_CATEGORY_KEYWORDS)) {
    if (words.some(w => t.includes(w))) out.push(id)
  }
  return out
}

// execFraudIntel 返回 JSON 字符串，这里解析为对象（失败时安全降级为空对象）
function parseToolResult(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw !== 'string') return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
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
    if (m[5]) return { action: 'set_time', time: m[6] || '', raw: t }  // empty time → status hint
    if (m[7]) return { action: 'set_interval', interval_hours: parseInt(m[8] || '12', 10), raw: t }
    if (m[9]) return { action: 'history', raw: t }
  }
  if (t.match(SCHEDULED_REMINDER_BARE_RE)) {
    return { action: 'status', raw: t }
  }
  return null
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
    let shortCircuit = false  // 工具已直接推送结果给用户，跳过 LLM 入队
    let handledBy = null      // 谁处理的（'fraud_intel_subcommand' | 'scheduled_reminder_subcommand'）

    // ── 工具级格式化输出：把工具结果直接渲染成用户可读的文本 ──
    function pushFraudIntelToUser(subcmd, result) {
      let text = ''
      const action = subcmd?.action || 'auto'
      if (action === '__auto__' || action === 'list') {
        if (result?.empty) {
          text = '【诈骗情报】当前缓存为空，先调 `/诈骗情报 采集` 联网拉取最新案例（10-30秒）。'
        } else {
          const cats = result?.categories || []
          const total = result?.total_cases ?? cats.reduce((s, c) => s + (c.cases?.length || 0), 0)
          const lines = [`【诈骗情报·缓存摘要】共 ${total} 条案例（更新于 ${result?.fetched_at || '未知'}）：`]
          for (const c of cats) {
            if (!c.cases?.length) continue
            lines.push('')
            lines.push(`▎ ${c.type}（${c.cases.length} 条）`)
            c.cases.slice(0, 3).forEach((it, i) => {
              lines.push(`  ${i + 1}. ${it.title}`)
              if (it.summary) lines.push(`     ${String(it.summary).slice(0, 100)}`)
            })
          }
          lines.push('')
          lines.push('> 提示：用 `/诈骗情报 搜索 关键词`（如 刷单/投资/贷款）查看具体案例；`/诈骗情报 推送` 把最新案例发到您微信。')
          text = lines.join('\n')
        }
      } else if (action === 'search') {
        const cases = result?.cases || []
        if (result?.empty) {
          text = '【诈骗情报·搜索】当前缓存为空，先调 `/诈骗情报 采集` 联网拉取。'
        } else if (cases.length === 0) {
          text = '【诈骗情报·搜索】关键词「' + (result?.keyword || subcmd.keyword) + '」无匹配案例。可放宽关键词或调 /诈骗情报 采集 刷新。'
        } else {
          const lines = [`【诈骗情报·搜索 ${result?.keyword || subcmd.keyword}】共 ${result?.total_matches} 条，展示前 ${result?.returned} 条：`]
          cases.forEach((c, i) => {
            lines.push('')
            lines.push(`${i + 1}. [${c.type}] ${c.title}`)
            if (c.summary) lines.push(`   ${String(c.summary).slice(0, 150)}`)
            if (c.url) lines.push(`   详情: ${c.url}`)
          })
          text = lines.join('\n')
        }
      } else if (action === 'fetch') {
        const total = result?.total_cases ?? 0
        const engine = result?.search_engine || '搜索引擎'
        if (result?.error) {
          text = `【诈骗情报·采集】${result.error}`
        } else {
          const cats = result?.categories || []
          const lines = [`【诈骗情报·采集完成】通过 ${engine} 拉取到 ${total} 条新案例：`]
          for (const c of cats) {
            if (!c.cases?.length) continue
            lines.push('')
            lines.push(`▎ ${c.type}（${c.case_count} 条）`)
            c.cases.slice(0, 2).forEach((it, i) => {
              lines.push(`  ${i + 1}. ${it.title}`)
              if (it.summary) lines.push(`     ${String(it.summary).slice(0, 100)}`)
            })
          }
          text = lines.join('\n')
        }
      } else if (action === 'push') {
        if (result?.empty) {
          text = '【诈骗情报·推送】缓存中没有案例，先调 `/诈骗情报 采集` 联网拉取。'
        } else if ((result?.wechat_pushed || 0) > 0) {
          text = `【诈骗情报·推送】已向 ${result.wechat_pushed} 个微信会话发送 ${result.push_count || 0} 条反诈提醒，请留意手机微信。`
        } else if ((result?.wechat_total || 0) === 0) {
          text = `【诈骗情报·推送】微信未绑定，无法自动推送。\n\n${result?.push_text || ''}`
        } else {
          text = `【诈骗情报·推送】微信推送未成功，请检查连接状态。\n\n${result?.push_text || ''}`
        }
      }
      if (text) {
        emitEvent('message', {
          from: 'consciousness',
          to: from_id,
          content: text,
          timestamp: new Date().toISOString(),
          channel: 'fraud_intel',
          source: 'fraud_intel_subcommand',
        })
      }
    }

    // 前置拦截：自然语言反诈推送请求（如"再推一条反诈提醒"），直接调工具 + 推给用户
    if (looksLikeFraudPushRequest(queuedContent)) {
      handledBy = 'fraud_intel_subcommand'
      try {
        const raw = await execFraudIntel({ action: 'push' })
        const result = parseToolResult(raw)
        preExecuted = result
        pushFraudIntelToUser({ action: 'push' }, result)
        shortCircuit = true
      } catch (err) {
        emitEvent('message', {
          from: 'consciousness',
          to: from_id,
          content: `【诈骗情报·推送】调用失败：${err.message}`,
          timestamp: new Date().toISOString(),
          channel: 'fraud_intel',
          source: 'fraud_intel_subcommand',
        })
        shortCircuit = true
      }
    }
    // 斜杠子命令拦截：`/诈骗情报 [采集|列表|推送|搜索 xxx]` —— 直接执行 + 推给用户
    const subcmd = parseFraudIntelSubcommand(queuedContent)
    if (subcmd) {
      handledBy = 'fraud_intel_subcommand'
      try {
        if (subcmd.action === '__auto__') {
          // 裸 `/诈骗情报`：缓存为空时后台触发一次 fetch（不阻塞）
          const cache = getFraudIntelCache()
          const hasCases = cache && cache.categories?.some(c => c.cases?.length > 0)
          if (!hasCases) {
            collectFraudIntel({ force: false }).catch(err =>
              console.warn('[fraud-intel] 后台采集失败:', err.message)
            )
            emitEvent('message', {
              from: 'consciousness',
              to: from_id,
              content: '【诈骗情报】当前缓存为空，已在后台启动联网采集（10-30秒），请稍候再次输入 `/诈骗情报` 查看。',
              timestamp: new Date().toISOString(),
              channel: 'fraud_intel',
              source: 'fraud_intel_subcommand',
            })
            shortCircuit = true
          } else {
            // 缓存有数据：直接调 list 工具 + 推给用户
            const raw = await execFraudIntel({ action: 'list' })
            const result = parseToolResult(raw)
            preExecuted = result
            pushFraudIntelToUser(subcmd, result)
            shortCircuit = true
          }
        } else if (subcmd.action === 'search' && subcmd.keyword) {
          const categoryIds = categoriesFromKeyword(subcmd.keyword)
          const raw = await execFraudIntel({
            action: 'search',
            keyword: subcmd.keyword,
            category_ids: categoryIds,
          })
          const result = parseToolResult(raw)
          preExecuted = result
          pushFraudIntelToUser(subcmd, result)
          shortCircuit = true
        } else if (subcmd.action === 'search' && !subcmd.keyword) {
          emitEvent('message', {
            from: 'consciousness',
            to: from_id,
            content: '【诈骗情报·搜索】请提供关键词，例如：`/诈骗情报 搜索 刷单`',
            timestamp: new Date().toISOString(),
            channel: 'fraud_intel',
            source: 'fraud_intel_subcommand',
          })
          shortCircuit = true
        } else {
          // fetch / list / push 子命令
          const raw = await execFraudIntel({ action: subcmd.action, force: subcmd.action === 'fetch' })
          const result = parseToolResult(raw)
          preExecuted = result
          pushFraudIntelToUser(subcmd, result)
          shortCircuit = true
        }
      } catch (err) {
        emitEvent('message', {
          from: 'consciousness',
          to: from_id,
          content: `【诈骗情报·${subcmd.action || 'auto'}】调用失败：${err.message}`,
          timestamp: new Date().toISOString(),
          channel: 'fraud_intel',
          source: 'fraud_intel_subcommand',
        })
        shortCircuit = true
      }
    }
    // ── /定时提醒 子命令拦截：直接调 scheduled_reminder 工具并推结果给用户 ──
    const reminderSub = parseScheduledReminderSubcommand(queuedContent)
    if (reminderSub) {
      handledBy = 'scheduled_reminder_subcommand'
      try {
        let action = reminderSub.action
        const argObj = { action }
        if (action === 'set_time') {
          // 用户可能写的是 "每天 9 点" 或 "9:00" — 简单正则提取 HH:MM
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
        } else if (action === 'set_interval') {
          argObj.interval_hours = reminderSub.interval_hours
        }
        const raw = await execScheduledReminder(argObj)
        const result = parseToolResult(raw)
        preExecuted = result
        // 推送结果到 UI
        emitEvent('message', {
          from: 'consciousness',
          to: from_id,
          content: result?.text || formatScheduledReminderFallback(result),
          timestamp: new Date().toISOString(),
          channel: 'scheduled_reminder',
          source: 'scheduled_reminder_subcommand',
        })
        shortCircuit = true
      } catch (err) {
        emitEvent('message', {
          from: 'consciousness',
          to: from_id,
          content: '【定时提醒】调用失败：' + err.message,
          timestamp: new Date().toISOString(),
          channel: 'scheduled_reminder',
          source: 'scheduled_reminder_subcommand',
        })
        shortCircuit = true
      }
    }
    function formatScheduledReminderFallback(r) {
      if (!r) return '【定时提醒】无响应'
      if (r.ok === false) return '【定时提醒】错误：' + (r.error || '未知错误')
      if (typeof r.enabled === 'boolean') {
        return `【定时提醒】当前${r.enabled ? '已开启' : '已关闭'}。模式: ${r.mode === 'daily' ? `每天 ${r.daily_time}` : `每 ${r.interval_hours} 小时`}`
      }
      return JSON.stringify(r)
    }
    // 工具已直接推送结果，跳过 LLM 入队（不污染对话历史和上下文）
    if (shortCircuit) {
      jsonResponse(res, 200, {
        ok: true,
        agent_name: getAgentName(),
        handled_by: handledBy || 'fraud_intel_subcommand',
        pre_executed: preExecuted && Object.keys(preExecuted).length > 0 ? preExecuted : null,
      })
      return true
    }
    const queued = pushMessage(from_id, queuedContentFinal, channel, meta)
    const conversationId = queued?.conversationId || 0
    emitEvent('message_in', { from_id, content: queuedContentFinal, channel, timestamp: new Date().toISOString(), conversation_id: conversationId, attachments: enhanced.media })
    jsonResponse(res, 200, { ok: true, agent_name: getAgentName(), conversation_id: conversationId, attachments: enhanced.media, pre_executed: preExecuted && Object.keys(preExecuted).length > 0 ? preExecuted : null })
  } catch (e) {
    if (claim?.claimed && claim.key) recentInboundMessages.delete(claim.key)
    jsonResponse(res, 400, { error: e.message })
  }
  return true
}
