// =============================================================================
// 短信分析工具：check_sms
//
// 供 LLM / 斜杠指令 /check_sms 直接调用，对一段短信 / 聊天文本做结构化风险拆解：
//   - 复用 src/context/fraud-rule-engine.js 的 runFraudRuleEngine(text) 做诈骗话术规则匹配
//   - 复用 src/services/rag-client.js 的 searchRiskTexts({ queryText }) 做相似案例检索
//   - 拼结构化风险拆解报告（话术证据 + 套路分步 + 相似案例 + 处置建议）
//
// 设计原则：
//   1. 轻量优先，直接在既有能力上组合，不重复造规则。
//   2. RAG 不可用（服务未起 / 402 / 超时）时降级：规则引擎结论照常给出，仅缺相似案例。
//   3. 可选 LLM 研判层（`llm: true` 启用）必须 try/catch 降级，绝不阻断主结论。
// =============================================================================

import {
  runFraudRuleEngine,
  FRAUD_RULE_ENGINE_VERSION,
} from '../../context/fraud-rule-engine.js'
import { searchRiskTexts } from '../../services/rag-client.js'
import { getMyClawbotId, getBinding, maybeNotifyBoundParent, RISK_PUSH_THRESHOLD, evaluateNotifyReason } from '../../social/parent-notify.js'

/**
 * 风险分 → 风险等级（与 fraud-rule-engine 分档一致）。
 * @param {number} score
 * @returns {string}
 */
function levelFromScore(score) {
  if (score >= 90) return '严重诈骗'
  if (score >= 70) return '高风险'
  if (score >= 50) return '中风险'
  if (score >= 30) return '低风险'
  return '无风险'
}

/**
 * 从短信文本里抽取可选的链接，交给 check_link 思路做补充提示（轻量：仅做正则粗检）。
 * @param {string} text
 * @returns {string[]}
 */
function extractUrls(text) {
  const re = /https?:\/\/[^\s"'<>）)]+|www\.[^\s"'<>）)]+/gi
  return [...new Set((String(text || '').match(re) || []).map(u => u.trim()))]
}

/**
 * 从调用上下文 / 参数中解析出「当前触发风险的子女」裸 clawbot id。
 * 优先取执行上下文带回的外部渠道原始 ID（含 wechat:clawbot: 前缀，由 getMyClawbotId 去前缀），
 * 退而求其次取参数里显式传入的发起者 ID。
 * @param {Object} args
 * @param {Object} ctx
 * @returns {string}
 */
function resolveChildClawbotId(args = {}, ctx = {}) {
  const raw = ctx?.currentExternalPartyId || ctx?.fromUserId || args?.fromUserId || args?.currentExternalPartyId || ''
  return getMyClawbotId({ externalPartyId: raw, fromId: raw })
}

/**
 * 对一段短信 / 聊天文本做结构化风险拆解。
 * @param {string|Object} input  文本，或 { text | content | message | sms }
 * @param {Object} [opts]
 * @param {boolean} [opts.llm]            是否启用可选 LLM 研判层（默认 false）。
 * @param {number}  [opts.topK]           RAG 相似案例返回条数（默认 5）。
 * @param {string}  [opts.riskCategoryHint] RAG 类目提示。
 * @returns {Promise<Object>} 结构化拆解结果
 */
export async function runCheckSms(input, { llm, topK, riskCategoryHint, ctx } = {}) {
  const raw = typeof input === 'string'
    ? input
    : (input?.text || input?.content || input?.message || input?.sms || '')
  const text = String(raw || '').trim()

  if (!text) {
    return {
      ok: false,
      tool: 'check_sms',
      error: 'empty_input',
      message: '请提供待分析的短信 / 聊天文本（参数 text）。',
    }
  }

  // 1) 规则引擎：诈骗话术匹配
  const rule = runFraudRuleEngine(text)
  const ruleHits = (rule.hits || []).map(h => ({
    id: h.id,
    type: h.type,
    risk: h.risk,
    score: h.score,
    matched_keywords: h.matchedKeywords || [],
    signals: h.signals || [],
    playbook: h.playbook || [],
    advice: h.advice || [],
  }))

  // 2) RAG 相似案例检索（降级：失败不阻断）
  let ragOk = false
  let ragError = ''
  let similarCases = []
  try {
    const rag = await searchRiskTexts({
      queryText: text,
      topK: topK && topK > 0 ? topK : 5,
      candidateK: 50,
      ...(riskCategoryHint ? { riskCategoryHint } : {}),
    })
    ragOk = true
    const items = Array.isArray(rag?.items) ? rag.items : []
    similarCases = items.map((it, idx) => ({
      rank: idx + 1,
      title: it.title || it.text?.slice(0, 60) || '(未命名案例)',
      category: it.category || it.category_code || it.risk_category || '',
      similarity: typeof it.score === 'number' ? it.score
        : typeof it.similarity === 'number' ? it.similarity
        : (typeof it.distance === 'number' ? 1 - it.distance : null),
      snippet: (it.text || it.snippet || '').slice(0, 200),
    }))
  } catch (err) {
    ragError = err?.message || 'RAG 检索失败'
  }

  // 3) 汇总 verdict
  const score = rule.score || 0
  const level = rule.level || levelFromScore(score)
  const urls = extractUrls(text)

  // ── 家长推送触发（中高危时 fire-and-forget）──
  // 子女账号触发中高危风险且已绑定家长时，向家长微信定向推送风险通知。
  const childId = resolveChildClawbotId(input, ctx)
  // 同步预判推送失败原因（不阻塞主流程），用于下方 report 可读提示。
  const parentNotifyReason = Number(score) >= RISK_PUSH_THRESHOLD ? evaluateNotifyReason(childId, score) : 'below_threshold'
  if (Number(score) >= RISK_PUSH_THRESHOLD) {
    // 实际家长微信推送：fire-and-forget，不阻塞主流程（结果已在 parentNotifyReason 中预判）。
    maybeNotifyBoundParent(childId, {
      score,
      level,
      kind: 'sms',
      fraudType: (ruleHits?.[0]?.type || '短信诈骗分析'),
      summary: (ruleHits?.[0]?.matched_keywords?.slice(0, 3).join('、') || '可疑短信').slice(0, 60),
      subjectRef: text.slice(0, 120),
      recordId: '',
    }).catch(() => {})
  }

  // 4) 处置建议（合并规则命中 + 通用）
  const adviceSet = new Set()
  for (const h of ruleHits) {
    for (const a of (h.advice || [])) adviceSet.add(a)
  }
  const advice = [
    ...adviceSet,
    '不点击短信内的陌生链接，不下载陌生 APP。',
    '不透露短信验证码、银行卡密码；公检法 / 银行不会电话索要验证码。',
    '疑似诈骗请拨打 96110（反诈专线）或 110 核实。',
  ].filter(Boolean)

  // 5) 可选 LLM 研判层（try/catch 降级）
  let llmAnalysis = null
  let llmNote = ''
  if (llm) {
    try {
      llmAnalysis = await runSmsLLMAnalysis(text, { score, level, ruleHits })
    } catch (err) {
      llmNote = `LLM 研判层不可用，已降级为规则+RAG 结论：${err?.message || 'unknown'}`
    }
  }

  let report = buildSmsReport({
    text, score, level, ruleHits, similarCases, ragOk, ragError,
    urls, advice, llmAnalysis, llmNote,
  })
  // 若推送未成功且有意义的失败原因，在报告末尾追加可读提示（与 check-link 一致）。
  if (parentNotifyReason && parentNotifyReason !== 'below_threshold' && parentNotifyReason !== 'eligible') {
    let hint = ''
    if (parentNotifyReason === 'no_binding') {
      hint = '尚未绑定家长微信，发送 /my_id 并把 ID 给家长完成 /bind_parent 绑定。'
    } else if (parentNotifyReason === 'parent_offline') {
      hint = '家长微信当前未连接小盾，无法推送；请家长在微信端重新联系小盾并保持在线。'
    }
    if (hint) {
      report += `\n\n[家长通知] ${hint}`
    }
  }

  return {
    ok: true,
    tool: 'check_sms',
    input: text,
    verdict: { score, level },
    rule_engine: {
      version: FRAUD_RULE_ENGINE_VERSION,
      summary: rule.summary || '',
      hits: ruleHits,
    },
    rag: {
      ok: ragOk,
      error: ragError || null,
      case_count: similarCases.length,
      cases: similarCases,
    },
    links: urls,
    advice: [...new Set(advice)],
    llm_analysis: llmAnalysis,
    llm_note: llmNote,
    report,
  }
}

// -----------------------------------------------------------------------------
// 报告渲染（复用「结构化风险拆解」风格）
// -----------------------------------------------------------------------------

/**
 * 生成人读报告（markdown 风格纯文本）。
 * @param {Object} p
 * @returns {string}
 */
function buildSmsReport(p) {
  const { text, score, level, ruleHits, similarCases, ragOk, ragError, urls, advice, llmAnalysis, llmNote } = p
  const lines = []
  lines.push(`【短信风险拆解】风险等级：${level}（风险分 ${score}/100）`)
  lines.push('')
  lines.push('原文：')
  lines.push(text.length > 400 ? `${text.slice(0, 400)}…（已截断）` : text)
  lines.push('')

  if (ruleHits.length === 0) {
    lines.push('话术规则：未命中已知诈骗话术特征。')
  } else {
    lines.push(`话术规则命中（${ruleHits.length} 类）：`)
    for (const h of ruleHits) {
      lines.push(`· [${h.risk === 'high' ? '高危' : h.risk === 'medium' ? '中危' : '低危'}] ${h.type}（得分 ${h.score}）`)
      if (h.matched_keywords?.length) lines.push(`  命中词：${h.matched_keywords.join('，')}`)
      if (h.signals?.length) lines.push(`  危险信号：${h.signals.join('；')}`)
      if (h.playbook?.length) {
        lines.push('  套路拆解：')
        for (const step of h.playbook) lines.push(`    ${step}`)
      }
    }
  }

  lines.push('')
  if (ragOk && similarCases.length > 0) {
    lines.push(`相似案例（RAG 检索 ${similarCases.length} 条）：`)
    for (const c of similarCases.slice(0, 5)) {
      const sim = c.similarity != null ? `（相似度 ${(Number(c.similarity) * 100).toFixed(0)}%）` : ''
      lines.push(`· ${c.title}${sim}${c.category ? ` [${c.category}]` : ''}`)
      if (c.snippet) lines.push(`  ${c.snippet}`)
    }
  } else {
    lines.push(`相似案例：RAG 检索不可用${ragError ? `（${ragError}）` : ''}，跳过；以规则引擎结论为准。`)
  }

  if (urls.length > 0) {
    lines.push('')
    lines.push(`内附链接（${urls.length}）：建议用 /check_link 逐一核验，勿直接点击。`)
    for (const u of urls.slice(0, 5)) lines.push(`· ${u}`)
  }

  lines.push('')
  lines.push('处置建议：')
  for (const a of advice) lines.push(`· ${a}`)

  if (llmAnalysis) {
    lines.push('')
    lines.push('LLM 研判补充：')
    lines.push(typeof llmAnalysis === 'string' ? llmAnalysis : JSON.stringify(llmAnalysis))
  } else if (llmNote) {
    lines.push('')
    lines.push(`（${llmNote}）`)
  }
  return lines.join('\n')
}

// -----------------------------------------------------------------------------
// 可选 LLM 研判层（lazy import + try/catch 降级）
// -----------------------------------------------------------------------------

/**
 * 可选 LLM 研判：对短信文本做综合诈骗意图研判。
 * 仅在 opts.llm 为真时调用；任何异常（含 402 余额不足）向上抛出由调用方降级。
 * @param {string} text
 * @param {Object} summary
 * @returns {Promise<string>}
 */
async function runSmsLLMAnalysis(text, summary) {
  const { callLLM } = await import('../../llm.js').catch(() => ({ callLLM: null }))
  if (typeof callLLM !== 'function') {
    throw new Error('LLM client unavailable')
  }
  const signal = AbortSignal.timeout(15000)
  const result = await callLLM({
    systemPrompt:
      '你是反诈研判助手。仅基于所给短信文本与已命中的规则信号，用 3-5 句中文给出该短信的诈骗定性、最可能出现的套路与优先级处置建议。不要编造事实，不要访问网络。',
    message: `短信：${text}\n本地研判：${JSON.stringify({ score: summary.score, level: summary.level, hits: (summary.ruleHits || []).map(h => h.type) })}`,
    tools: [],
    temperature: 0.2,
    maxTokens: 320,
    thinking: false,
    mustReply: true,
    signal,
  })
  return (result && result.content) ? String(result.content).trim() : ''
}

// -----------------------------------------------------------------------------
// 工具入口（executor 调用）
// -----------------------------------------------------------------------------

/**
 * 短信分析工具入口，返回 JSON 字符串。
 * @param {string|Object} args  文本，或 { text, content, message, sms, llm, top_k }
 * @returns {Promise<string>}
 */
export async function execCheckSms(args = {}, ctx = {}) {
  try {
    const llm = Boolean(typeof args === 'object' ? args.llm : false)
    const topK = typeof args === 'object' && args.top_k ? Number(args.top_k) : undefined
    const riskCategoryHint = typeof args === 'object' ? (args.risk_category_hint || args.riskCategoryHint) : undefined
    const result = await runCheckSms(args, { llm, topK, riskCategoryHint, ctx })
    return JSON.stringify({ ok: true, ...result }, null, 2)
  } catch (error) {
    return JSON.stringify({
      ok: false,
      tool: 'check_sms',
      error: error?.code || 'CHECK_SMS_ERROR',
      message: error?.message || '短信分析失败',
    }, null, 2)
  }
}

export const CHECK_SMS_VERSION = '1.0.0'
