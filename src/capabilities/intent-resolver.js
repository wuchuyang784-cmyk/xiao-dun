// =============================================================================
// intent-resolver.js —— 面板 / 能力调用的「意图路由」层
//
// 现状缺口：面板工具（hotspot_mode 等）默认 toolWhen=false，只有关键词命中时才
//   注入对应工作流块，而工具本身仍不自动注入（靠 LLM 调 find_tool 装载）。
//   一旦用户用「非关键词」的自由表述，正则 miss → 无 context、无工具 →
//   面板永远不会被打开。
//
// 本模块补上「意图路由」，三层递进：
//   1) 显式指令快车道：消息以 /hotspot /weather ... 开头 → 直接强制激活对应
//      能力（确定性、零 LLM、最低延迟）。覆盖前端斜杠菜单之外的渠道。
//   2) 关键词路径：命中既有 detect 即视为已路由，return null 走原流程（保持原
//      toolWhen 行为，不强制，避免绕过"面板工具不自动注入"的刻意设计）。
//   3) LLM 意图兜底：前两者都没命中、且消息不像闲聊时，用一次轻量分类在能力
//      清单里选最匹配的能力并强制注入其工具 + 工作流块，让 LLM 能直接选它。
//
// 产物：{ capabilityId, via } 或 null（null = 不强制，沿用现状，零回归）。
//   via: 'command'（显式指令）| 'llm'（LLM 意图兜底）
// =============================================================================

import {
  selectActiveCapabilities,
  getCapability,
  listCapabilities,
} from './capability-registry.js'

// 显式斜杠指令 → 能力 id 的快车道映射。
const EXPLICIT_COMMANDS = {
  '/hotspot': 'hotspot',
  '/热点': 'hotspot',
  '/weather': 'weather',
  '/天气': 'weather',
  '/web': 'web',
  '/上网': 'web',
  // 反诈功能 #2 — 诈骗情报
  '/fraud_intel': 'fraud-intel',
  '/诈骗情报': 'fraud-intel',
  // 反诈功能 #3 — 每日提醒
  '/daily_tip': 'daily-tip',
  '/每日提醒': 'daily-tip',
  // 反诈功能 #4 — 反诈工具箱（4 个工具共用一个能力）
  '/report_fraud': 'fraud-toolkit',
  '/举报': 'fraud-toolkit',
  '/search_law': 'fraud-toolkit',
  '/查法规': 'fraud-toolkit',
  '/check_qrcode': 'fraud-toolkit',
  '/查二维码': 'fraud-toolkit',
  '/verify_identity': 'fraud-toolkit',
  '/核实身份': 'fraud-toolkit',
  // 反诈功能 #1 — 诈骗风险研判
  '/analyze': 'fraud-risk-assess',
  '/研判': 'fraud-risk-assess',
}

// 纯闲聊 / 无意义短消息：这些永远不需要打开面板，直接跳过 LLM 兜底分类以省延迟。
// 仅靠极短长度 + 常见寒暄词判断；真实功能请求通常更长或含动作动词。
const GREETING_RE = /^(你好|您好|hi|hello|hey|在吗|在么|在不在|谢谢|感谢|thanks|thank you|好的|好|ok|okay|嗯|恩|额|哈哈|哈哈哈|测试|test)/i

export function resolveExplicitCommand(message = '') {
  const m = String(message || '').trim()
  if (!m.startsWith('/')) return null
  const head = m.split(/\s+/)[0].toLowerCase()
  return EXPLICIT_COMMANDS[head] || null
}

function looksLikeChat(message = '') {
  const m = String(message || '').trim()
  if (m.length <= 4) return true
  return GREETING_RE.test(m)
}

const INTENT_SYSTEM_TEMPLATE = `你是小盾智能体的意图路由器。根据用户消息，从下方「能力清单」中选出最匹配的一个能力；若都不匹配，返回 "none"。
只输出一个 JSON 对象，不要有任何多余文字或解释：
{"capability":"<能力 id 或 none>","reason":"<不超过 20 字的中文理由>"}

能力清单：
__CAPABILITIES__`

function buildIntentSystemPrompt() {
  const caps = listCapabilities()
    .map((c) => `- ${c.id}（${c.label}）：${c.summary}`)
    .join('\n')
  return INTENT_SYSTEM_TEMPLATE.replace('__CAPABILITIES__', caps)
}

// 容忍模型在 JSON 前后夹带文字：抽取第一个 {...} 片段再解析。
function parseIntentResult(raw = '') {
  if (!raw) return null
  const match = String(raw).match(/\{[\s\S]*?\}/)
  if (!match) return null
  try {
    const obj = JSON.parse(match[0])
    if (obj && typeof obj.capability === 'string') {
      return { capability: obj.capability.trim(), reason: obj.reason || '' }
    }
  } catch {
    /* 解析失败当作无匹配 */
  }
  return null
}

// 主入口：返回 { capabilityId, via } 或 null。
//   callLLM：复用主循环的 LLM 调用（签名同 llm.js 的 callLLM）。
export async function resolveCapabilityIntent(message, { callLLM, signal } = {}) {
  const text = String(message || '')

  // 1) 显式指令快车道（零 LLM）
  const explicit = resolveExplicitCommand(text)
  if (explicit) return { capabilityId: explicit, via: 'command' }

  // 2) 关键词已命中：既有 detect 流程会注入 context，无需强制（保持原 toolWhen 行为）。
  const active = selectActiveCapabilities({ text: text.toLowerCase(), rawText: text })
  if (active.length > 0) return null

  // 3) LLM 意图兜底：仅对非闲聊、非关键词命中的消息触发一次轻量分类。
  if (looksLikeChat(text)) return null
  if (typeof callLLM !== 'function') return null

  try {
    const result = await callLLM({
      systemPrompt: buildIntentSystemPrompt(),
      message: text,
      tools: [],
      temperature: 0.1,
      maxTokens: 200,
      thinking: false,
      mustReply: true,
      ...(signal ? { signal } : {}),
    })
    const parsed = parseIntentResult(result && result.content)
    if (
      parsed &&
      parsed.capability &&
      parsed.capability !== 'none' &&
      getCapability(parsed.capability)
    ) {
      return { capabilityId: parsed.capability, via: 'llm' }
    }
  } catch (err) {
    // 降级：LLM 不可用 / 分类失败时不强制任何能力（与现状一致，绝不回归）。
    console.warn('[intent-resolver] LLM 意图分类失败，降级为不强制:', err && err.message)
  }
  return null
}
