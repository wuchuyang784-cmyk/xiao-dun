import crypto from 'node:crypto'

import { insertAnalysisRecord } from '../../db/repositories/analysis-records.js'
import {
  runFraudRuleEngine,
  FRAUD_RULE_ENGINE_VERSION,
} from '../../context/fraud-rule-engine.js'
import { searchRiskTexts } from '../../services/rag-client.js'
import { execAnalyzeImage } from './api-capability.js'
import { execCheckLink } from './check-link.js'
import { hasImageReference, hasFraudImageIntent } from '../fraud-image-intent.js'

const URL_RE = /https?:\/\/[^\s"'<>）)]+|www\.[^\s"'<>）)]+/gi

function toolJson(payload) {
  return JSON.stringify(payload, null, 2)
}

function extractUrls(text = '') {
  return [...new Set((String(text || '').match(URL_RE) || []).map(url => url.trim()))].slice(0, 5)
}

function parseJsonResult(value = '') {
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return null
  }
}

function parseVisionResult(value = '') {
  const text = String(value || '').trim()
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1]
  const candidate = fenced || text.match(/\{[\s\S]*\}/)?.[0]
  if (!candidate) {
    return {
      imageType: 'unknown',
      summary: '',
      extractedText: text,
      entities: {},
      uncertainties: [],
    }
  }

  try {
    const parsed = JSON.parse(candidate)
    return {
      imageType: String(parsed.image_type || parsed.type || 'unknown'),
      summary: String(parsed.summary || '').trim(),
      extractedText: String(
        parsed.extracted_text
        || parsed.ocr_text
        || parsed.text
        || '',
      ).trim(),
      entities: parsed.entities && typeof parsed.entities === 'object'
        ? parsed.entities
        : {},
      uncertainties: Array.isArray(parsed.uncertainties)
        ? parsed.uncertainties.map(String)
        : [],
    }
  } catch {
    return {
      imageType: 'unknown',
      summary: '',
      extractedText: text,
      entities: {},
      uncertainties: ['视觉模型返回的结构化结果无法解析'],
    }
  }
}

function buildVisionPrompt(userIntent = '') {
  return `你是小盾的图片反诈取证模块。请只提取图片中的客观信息，不要直接做最终诈骗结论。
用户意图：${userIntent || '判断图片内容是否存在诈骗风险'}

请严格返回 JSON，不要输出 Markdown 代码围栏：
{
  "image_type": "chat_screenshot | payment_screenshot | qr_code | link_screenshot | document | unknown",
  "summary": "一句话描述图片内容",
  "extracted_text": "按阅读顺序提取图片中的可见文字",
  "entities": {
    "urls": [],
    "phones": [],
    "amounts": [],
    "accounts": [],
    "qr_codes": [],
    "identity_claims": []
  },
  "uncertainties": []
}`
}

function normalizeRuleHits(rule = {}) {
  return (rule.hits || []).map(hit => ({
    id: hit.id,
    type: hit.type,
    risk: hit.risk,
    score: hit.score,
    matched_keywords: hit.matchedKeywords || [],
    signals: hit.signals || [],
    playbook: hit.playbook || [],
    advice: hit.advice || [],
  }))
}

function normalizeRagCases(items = []) {
  if (!Array.isArray(items)) return []
  return items.map((item, index) => {
    const similarity = typeof item.similarity_score === 'number'
      ? item.similarity_score
      : typeof item.score === 'number'
        ? item.score
        : typeof item.similarity === 'number'
          ? item.similarity
          : typeof item.distance === 'number'
            ? 1 - item.distance
            : null
    const snippet = String(
      item.normalized_text || item.text || item.snippet || '',
    ).slice(0, 240)
    return {
      rank: index + 1,
      id: item.risk_text_id || item.case_id || item.id || '',
      title: item.title || item.risk_text_title || snippet.slice(0, 60) || '(未命名案例)',
      category: item.risk_category_name
        || item.category
        || item.category_name
        || item.category_code
        || item.risk_category
        || item.risk_category_code
        || '',
      category_code: item.risk_category_code || item.category_code || '',
      similarity,
      similarity_level: item.similarity_level || '',
      similarity_reason: item.similarity_reason || '',
      snippet,
      year: item.year || null,
      source_dataset: item.source_dataset || item.source || '',
    }
  })
}

function scoreLevel(score = 0) {
  if (score >= 90) return '严重诈骗'
  if (score >= 70) return '高风险'
  if (score >= 50) return '中风险'
  if (score >= 30) return '低风险'
  return '无风险'
}

function buildReport({ vision, extractedText, rule, ruleHits, ragCases, linkChecks }) {
  const score = Number(rule.score || 0)
  const level = rule.level || scoreLevel(score)
  const lines = [
    `【图片涉诈分析】风险等级：${level}（风险分 ${score}/100）`,
    '',
    '一、图片内容识别',
    vision.summary || `图片类型：${vision.imageType || 'unknown'}`,
  ]

  if (extractedText) {
    lines.push('', '二、识别出的文字', extractedText.slice(0, 1200))
  }

  lines.push('', '三、可疑话术与规则命中')
  if (ruleHits.length === 0) {
    lines.push('未命中明确的已知诈骗话术规则，不能仅凭本次结果认定为安全。')
  } else {
    for (const hit of ruleHits) {
      lines.push(`· ${hit.type || '风险信号'}：${hit.risk || 'unknown'}，得分 ${hit.score || 0}`)
      if (hit.matched_keywords.length) lines.push(`  命中词：${hit.matched_keywords.join('，')}`)
      if (hit.signals.length) lines.push(`  危险信号：${hit.signals.join('；')}`)
    }
  }

  lines.push('', '四、外部 RAG 相似案例')
  if (ragCases.length === 0) {
    lines.push('未取得可展示的相似案例。')
  } else {
    for (const item of ragCases.slice(0, 5)) {
      const similarity = item.similarity == null
        ? ''
        : `（相似度 ${(Number(item.similarity) * 100).toFixed(0)}%）`
      lines.push(`· ${item.title}${similarity}${item.category ? ` [${item.category}]` : ''}`)
      if (item.snippet) lines.push(`  ${item.snippet}`)
    }
  }

  lines.push('', '五、链接风险')
  if (linkChecks.length === 0) {
    lines.push('未识别到可检测链接。')
  } else {
    for (const item of linkChecks) {
      lines.push(`· ${item.url}：${item.risk_level || item.level || item.error || '未完成检测'}`)
    }
  }

  lines.push(
    '',
    '六、处置建议',
    '· 不要点击图片中的陌生链接或扫描未知二维码。',
    '· 不要提供短信验证码、银行卡密码、支付密码或身份证信息。',
    '· 涉及转账、账户冻结、退款或“安全账户”时，请通过官方渠道或 96110/110 核实。',
    '· 保留原图、聊天记录和转账凭证，必要时报警。',
  )

  return { score, level, markdown: lines.join('\n') }
}

function recordAnalysis({ vision, extractedText, ruleHits, report, durationMs }) {
  const recordId = `fraud-image-${crypto.randomUUID()}`
  try {
    insertAnalysisRecord({
      recordId,
      inputSummary: (vision.summary || extractedText || '图片涉诈分析').slice(0, 300),
      inputHash: crypto.createHash('sha256').update(extractedText || '').digest('hex'),
      fraudType: ruleHits[0]?.type || '图片涉诈分析',
      riskLevel: report.level,
      rulesHit: ruleHits,
      modelUsed: 'vision + rule + external-rag',
      latencyMs: durationMs,
      source: 'analyze_fraud_image',
    }, { ignoreConflict: true })
  } catch {
    // Analysis output must not fail only because local audit persistence is unavailable.
  }
  return recordId
}

export async function execAnalyzeFraudImage(args = {}, context = {}) {
  const startedAt = Date.now()
  const userIntent = String(
    args.user_intent
    || args.userIntent
    || context.currentUserMessage
    || '',
  ).trim()
  const imageRef = String(
    args.image_path
    || args.imagePath
    || args.image_url
    || args.imageUrl
    || '',
  ).trim()
  const eligibilityText = `${context.currentUserMessage || ''}\n${userIntent}\n${imageRef}`

  if (!hasImageReference(eligibilityText) || !hasFraudImageIntent(eligibilityText)) {
    return toolJson({
      ok: false,
      tool: 'analyze_fraud_image',
      error: 'not_eligible',
      message: '图片涉诈分析需要同时满足：存在图片，且用户明确表达诈骗或风险分析意图。',
    })
  }

  const visionRaw = await execAnalyzeImage({
    ...(imageRef.startsWith('http') || imageRef.startsWith('data:image/')
      ? { image_url: imageRef }
      : imageRef
        ? { image_path: imageRef }
        : {}),
    prompt: buildVisionPrompt(userIntent),
    detail: args.detail || 'high',
  }, context)
  const visionEnvelope = parseJsonResult(visionRaw)
  if (!visionEnvelope?.ok) {
    return toolJson({
      ok: false,
      tool: 'analyze_fraud_image',
      stage: 'vision',
      error: visionEnvelope?.error || 'vision_failed',
      message: visionEnvelope?.guide || '图片视觉分析不可用。',
    })
  }

  const vision = parseVisionResult(visionEnvelope.result)
  const extractedText = vision.extractedText.trim()
  if (!extractedText) {
    return toolJson({
      ok: false,
      tool: 'analyze_fraud_image',
      stage: 'ocr',
      error: 'empty_extracted_text',
      message: '图片中没有识别到足够的文字，暂时无法进行聊天记录诈骗分析。',
      vision,
    })
  }

  const rule = runFraudRuleEngine(extractedText)
  const ruleHits = normalizeRuleHits(rule)
  let ragCases = []
  let ragError = ''
  try {
    const rag = await searchRiskTexts({
      queryText: extractedText,
      topK: args.top_k ?? args.topK ?? 5,
      candidateK: 50,
    })
    ragCases = normalizeRagCases(rag?.items)
  } catch (error) {
    ragError = error?.message || 'RAG 检索失败'
  }

  const linkChecks = []
  for (const url of extractUrls(extractedText).slice(0, 5)) {
    const raw = await execCheckLink({ url })
    const result = parseJsonResult(raw) || { ok: false, error: 'invalid_link_result' }
    linkChecks.push({ url, ...result })
  }

  const report = buildReport({ vision, extractedText, rule, ruleHits, ragCases, linkChecks })
  const recordId = recordAnalysis({
    vision,
    extractedText,
    ruleHits,
    report,
    durationMs: Date.now() - startedAt,
  })

  return toolJson({
    ok: true,
    tool: 'analyze_fraud_image',
    record_id: recordId,
    vision,
    extracted_text: extractedText,
    rule_engine: {
      version: FRAUD_RULE_ENGINE_VERSION,
      score: Number(rule.score || 0),
      level: rule.level || scoreLevel(rule.score || 0),
      hits: ruleHits,
      summary: rule.summary || '',
    },
    rag: {
      ok: !ragError,
      error: ragError || null,
      case_count: ragCases.length,
      cases: ragCases,
    },
    links: {
      detected: extractUrls(extractedText),
      checked: linkChecks,
    },
    risk: {
      score: report.score,
      level: report.level,
    },
    report: report.markdown,
  })
}
