import crypto from 'node:crypto'

import { createAnalysisRecord } from '../../services/analysis-record-service.js'
import { searchRiskTexts } from '../../services/rag-client.js'
import { execAnalyzeImage } from './api-capability.js'
import { execCheckLink } from './check-link.js'
import { runCheckSms } from './check-sms.js'
import { normalizeRagCases } from './rag-format.js'

const URL_RE = /https?:\/\/[^\s)\]}>{"'\uFF0C\u3002\uFF01\uFF1F]+/gi

function toolJson(payload) {
  return JSON.stringify(payload, null, 2)
}

function extractUrls(text = '') {
  return [...new Set(String(text || '').match(URL_RE) || [])].slice(0, 8)
}

function parseJsonObject(text = '') {
  const raw = String(text || '').trim()
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i)?.[1]
  const objectText = fenced || raw.match(/\{[\s\S]*\}/)?.[0] || ''
  if (!objectText) return null
  try { return JSON.parse(objectText) } catch { return null }
}

function safeVisionResult(result = '') {
  const parsed = parseJsonObject(result)
  if (!parsed) {
    return {
      imageType: 'unknown',
      summary: '',
      extractedText: String(result || '').trim(),
      entities: {},
      uncertainties: [],
    }
  }
  return {
    imageType: String(parsed.image_type || parsed.imageType || parsed.type || 'unknown'),
    summary: String(parsed.summary || '').trim(),
    extractedText: String(parsed.extracted_text || parsed.extractedText || parsed.text || parsed.ocr_text || '').trim(),
    entities: parsed.entities && typeof parsed.entities === 'object' ? parsed.entities : {},
    uncertainties: Array.isArray(parsed.uncertainties) ? parsed.uncertainties.map(String) : [],
  }
}

function arr(value) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function buildVisionPrompt(userIntent = '') {
  return `You are XiaoDun's OCR and visual extraction module for anti-fraud analysis. Extract facts only; do not make the final fraud verdict.\n\nUser intent: ${userIntent || 'Analyze whether this image contains scam risk'}\n\nReturn JSON only with this shape:\n{\n  "image_type": "chat_screenshot | payment_screenshot | qr_code | link_screenshot | document | unknown",\n  "summary": "one sentence in Chinese",\n  "extracted_text": "all visible text in reading order",\n  "entities": {\n    "urls": [],\n    "phones": [],\n    "amounts": [],\n    "accounts": [],\n    "qr_codes": [],\n    "identity_claims": []\n  },\n  "uncertainties": []\n}`
}

function scoreFromSmsResult(sms = {}) {
  return Number(sms.verdict?.score ?? sms.score ?? sms.risk_score ?? 0) || 0
}

function levelFromScore(score) {
  if (score >= 80) return 'critical'
  if (score >= 60) return 'high'
  if (score >= 35) return 'medium'
  return 'low'
}

function levelLabel(level = '') {
  const key = String(level || '').toLowerCase()
  if (key === 'critical') return '\u4e25\u91cd\u8bc8\u9a97\u98ce\u9669'
  if (key === 'high') return '\u9ad8\u98ce\u9669'
  if (key === 'medium') return '\u4e2d\u98ce\u9669'
  return '\u4f4e\u98ce\u9669'
}

function normalizeRiskLevel(level = '') {
  const key = String(level || '').toLowerCase()
  if (key === 'critical') return 'critical'
  if (key === 'high') return 'high'
  if (key === 'medium') return 'medium'
  return 'low'
}

function imageSubjectRef(args = {}) {
  return args.image_path || args.imagePath || args.image_url || args.imageUrl || ''
}

function persistFailedImageRecord({ args = {}, userIntent = '', startedAt = Date.now(), error = '', model = '' } = {}) {
  const imageRef = imageSubjectRef(args)
  const record = createAnalysisRecord({
    recordId: `fraud-image-${crypto.randomUUID()}`,
    inputSummary: String(userIntent || imageRef || 'image fraud analysis failed').slice(0, 300),
    inputHash: crypto.createHash('sha256').update(String(userIntent || imageRef || '')).digest('hex'),
    fraudType: 'image fraud analysis',
    riskLevel: 'low',
    rulesHit: [],
    modelUsed: model,
    latencyMs: Date.now() - startedAt,
    alertSent: false,
    feedback: null,
    source: 'analyze_fraud_image',
    analysisKind: 'image',
    subjectKind: imageRef ? 'image' : 'unknown',
    subjectRef: imageRef,
    toolName: 'analyze_fraud_image',
    analysisStatus: 'failed',
    failureReason: String(error || 'vision_failed'),
    reportMarkdown: '',
  })
  return record.recordId
}

function collectEntityUrls(entities = {}) {
  return arr(entities.urls || entities.links || entities.url)
}

function buildReport({ vision, sms, ragCases, linkChecks }) {
  const score = scoreFromSmsResult(sms)
  const level = sms.verdict?.level || sms.level || levelFromScore(score)
  const hits = sms.rule_engine?.hits || []
  const lines = []

  lines.push(`\u3010\u56fe\u7247\u804a\u5929\u8bb0\u5f55\u98ce\u9669\u5206\u6790\u3011\u98ce\u9669\u7b49\u7ea7\uff1a${levelLabel(level)}\uff08\u98ce\u9669\u5206 ${score}/100\uff09`)
  lines.push('')
  lines.push('\u4e00\u3001\u56fe\u7247\u5185\u5bb9\u8bc6\u522b')
  lines.push(vision.summary || '\u5df2\u5c1d\u8bd5\u8bc6\u522b\u56fe\u7247\u5185\u5bb9\u3002')

  if (vision.extractedText) {
    lines.push('')
    lines.push('\u4e8c\u3001\u8bc6\u522b\u51fa\u7684\u5173\u952e\u6587\u5b57')
    lines.push(vision.extractedText.length > 800 ? `${vision.extractedText.slice(0, 800)}...` : vision.extractedText)
  }

  lines.push('')
  lines.push('\u4e09\u3001\u53ef\u7591\u8bdd\u672f\u4e0e\u89c4\u5219\u547d\u4e2d')
  if (hits.length) {
    for (const hit of hits) {
      const title = hit.type || hit.name || '\u98ce\u9669\u4fe1\u53f7'
      const risk = hit.risk ? ` ${hit.risk}` : ''
      const hitScore = hit.score != null ? ` \u5f97\u5206 ${hit.score}` : ''
      lines.push(`\u00b7 ${title}${risk}${hitScore}`)
    }
  } else {
    lines.push('\u672a\u547d\u4e2d\u660e\u786e\u9ad8\u5371\u89c4\u5219\uff1b\u4ecd\u9700\u7ed3\u5408\u56fe\u7247\u4e0a\u4e0b\u6587\u8c28\u614e\u5224\u65ad\u3002')
  }

  lines.push('')
  lines.push('\u56db\u3001\u5916\u90e8 RAG \u76f8\u4f3c\u6848\u4f8b')
  if (ragCases.length) {
    for (const item of ragCases.slice(0, 5)) {
      const sim = item.similarity == null ? '' : `\uff08\u76f8\u4f3c\u5ea6 ${(Number(item.similarity) * 100).toFixed(0)}%\uff09`
      lines.push(`\u00b7 ${item.title}${sim}${item.category ? ` [${item.category}]` : ''}`)
      if (item.snippet) lines.push(`  ${item.snippet}`)
    }
  } else {
    lines.push('\u672a\u53d6\u5f97\u53ef\u5c55\u793a\u7684\u76f8\u4f3c\u6848\u4f8b\u3002')
  }

  lines.push('')
  lines.push('\u4e94\u3001\u94fe\u63a5\u6216\u4e8c\u7ef4\u7801\u98ce\u9669')
  if (linkChecks.length) {
    for (const check of linkChecks) {
      lines.push(`\u00b7 ${check.url || ''}\uff1a${check.risk_level || check.level || 'unknown'}`)
    }
  } else {
    lines.push('\u672a\u8bc6\u522b\u5230\u53ef\u68c0\u6d4b\u94fe\u63a5\u3002')
  }

  lines.push('')
  lines.push('\u516d\u3001\u5efa\u8bae')
  lines.push('\u00b7 \u4e0d\u8981\u70b9\u51fb\u56fe\u7247\u4e2d\u7684\u964c\u751f\u94fe\u63a5\u6216\u626b\u63cf\u672a\u77e5\u4e8c\u7ef4\u7801\u3002')
  lines.push('\u00b7 \u4e0d\u8981\u63d0\u4f9b\u9a8c\u8bc1\u7801\u3001\u94f6\u884c\u5361\u3001\u8eab\u4efd\u8bc1\u3001\u652f\u4ed8\u5bc6\u7801\u3002')
  lines.push('\u00b7 \u6d89\u53ca\u8f6c\u8d26\u6216\u8d26\u6237\u51bb\u7ed3\uff0c\u8bf7\u901a\u8fc7\u5b98\u65b9 App \u6216 96110/110 \u6838\u5b9e\u3002')
  lines.push('\u00b7 \u4fdd\u7559\u622a\u56fe\u3001\u804a\u5929\u8bb0\u5f55\u3001\u8f6c\u8d26\u51ed\u8bc1\uff0c\u5fc5\u8981\u65f6\u62a5\u8b66\u3002')

  return { level, score, markdown: lines.join('\n') }
}

async function checkLinks(urls = []) {
  const out = []
  for (const url of urls.slice(0, 5)) {
    try {
      const parsed = JSON.parse(await execCheckLink({ url }))
      out.push({ url, ...parsed })
    } catch (error) {
      out.push({ url, ok: false, error: error?.message || 'link check failed' })
    }
  }
  return out
}

export async function execAnalyzeFraudImage(args = {}, context = {}) {
  const startedAt = Date.now()
  const userIntent = String(args.user_intent || args.userIntent || context.currentUserMessage || '').trim()
  const topK = Math.min(20, Math.max(1, Number(args.top_k ?? args.topK ?? 5) || 5))

  let visionEnvelope
  try {
    visionEnvelope = JSON.parse(await execAnalyzeImage({
      image_path: args.image_path || args.imagePath,
      image_url: args.image_url || args.imageUrl,
      prompt: buildVisionPrompt(userIntent),
      detail: args.detail || 'high',
    }, context))
  } catch (error) {
    const recordId = persistFailedImageRecord({ args, userIntent, startedAt, error: error?.message || 'vision_failed' })
    return toolJson({ ok: false, tool: 'analyze_fraud_image', stage: 'vision', record_id: recordId, error: error?.message || 'vision_failed' })
  }

  if (!visionEnvelope.ok) {
    const recordId = persistFailedImageRecord({
      args,
      userIntent,
      startedAt,
      error: visionEnvelope.error || visionEnvelope.message || 'vision_failed',
      model: visionEnvelope.model || '',
    })
    return toolJson({
      ok: false,
      tool: 'analyze_fraud_image',
      stage: 'vision',
      record_id: recordId,
      error: visionEnvelope.error || visionEnvelope.message || 'vision_failed',
      docs_hint: visionEnvelope.docs_hint || visionEnvelope.guide || '',
    })
  }

  const vision = safeVisionResult(visionEnvelope.result)
  const extractedText = vision.extractedText || userIntent
  const urls = [...new Set([...collectEntityUrls(vision.entities), ...extractUrls(extractedText)])]

  const sms = await runCheckSms(extractedText, { topK })
  let ragCases = normalizeRagCases(sms.rag?.cases || [])

  if (!ragCases.length && extractedText.trim()) {
    try {
      const rag = await searchRiskTexts({ queryText: extractedText, topK, candidateK: 50 })
      ragCases = normalizeRagCases(rag.items)
    } catch {}
  }

  const linkChecks = await checkLinks(urls)
  const report = buildReport({ vision, sms, ragCases, linkChecks })
  const imageRef = imageSubjectRef(args)
  const recordId = `fraud-image-${crypto.randomUUID()}`

  try {
    createAnalysisRecord({
      recordId,
      inputSummary: (vision.summary || extractedText || userIntent).slice(0, 300),
      inputHash: crypto.createHash('sha256').update(extractedText || userIntent).digest('hex'),
      fraudType: ragCases[0]?.category || sms.rule_engine?.hits?.[0]?.type || '\u56fe\u7247\u6d89\u8bc8\u5206\u6790',
      riskLevel: normalizeRiskLevel(report.level),
      rulesHit: sms.rule_engine?.hits || [],
      modelUsed: visionEnvelope.model || '',
      latencyMs: Date.now() - startedAt,
      source: 'analyze_fraud_image',
      analysisKind: 'image',
      subjectKind: imageRef ? 'image' : 'unknown',
      subjectRef: imageRef || '',
      toolName: 'analyze_fraud_image',
      analysisStatus: linkChecks.some((item) => item?.ok === false) || !sms.rag?.ok ? 'partial' : 'done',
      failureReason: [
        !sms.rag?.ok ? sms.rag?.error || 'RAG unavailable' : '',
        linkChecks.some((item) => item?.ok === false) ? 'link check partial' : '',
      ].filter(Boolean).join('; '),
      reportMarkdown: report.markdown,
    })
  } catch {}

  return toolJson({
    ok: true,
    tool: 'analyze_fraud_image',
    record_id: recordId,
    vision,
    extracted_text: extractedText,
    rule_engine: sms.rule_engine,
    rag: { ok: Boolean(sms.rag?.ok || ragCases.length), case_count: ragCases.length, cases: ragCases },
    links: { detected: urls, checked: linkChecks },
    risk: { level: report.level, score: report.score },
    report: report.markdown,
  })
}
