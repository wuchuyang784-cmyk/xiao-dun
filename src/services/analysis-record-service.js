import { emitEvent } from '../events.js'
import {
  insertAnalysisRecord,
  listAnalysisRecords as queryAnalysisRecords,
  getAnalysisRecordStats as queryAnalysisRecordStats,
} from '../db/repositories/analysis-records.js'

// ─────────────────────────────────────────────────────────────
// 个人 AI 分析记录服务
//
// 作用：记录个人智能体每次 AI 分析的本地记录，
// 供用户回溯、统计和审计。仅限本地使用，不对外提供接口。
//
// 字段说明：
//   recordId?     唯一幂等键（不传则服务端生成）
//   inputSummary  脱敏后的消息摘要（不存原文）
//   inputHash     内容指纹（可选，用于去重）
//   fraudType     命中诈骗类型
//   riskLevel     low|medium|high|critical
//   rulesHit      命中的规则 id 数组
//   modelUsed     使用的模型名
//   latencyMs     分析耗时（毫秒）
//   alertSent     是否触发了主动告警
//   feedback      用户反馈（可选）
//   source        来源：local_agent（默认）
// ─────────────────────────────────────────────────────────────

const SUPPORTED_RISKS = ['low', 'medium', 'high', 'critical']

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeRisk(value) {
  const risk = String(value ?? 'low').trim().toLowerCase()
  if (!SUPPORTED_RISKS.includes(risk)) throw new Error(`riskLevel must be one of: ${SUPPORTED_RISKS.join(', ')}`)
  return risk
}

function normalizeRecord(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('analysis record must be an object')
  }

  let rulesHit = input.rulesHit
  if (typeof rulesHit === 'string') {
    try { rulesHit = JSON.parse(rulesHit) } catch { rulesHit = [] }
  }
  if (!Array.isArray(rulesHit)) rulesHit = []

  const recordId = String(input.recordId || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`).trim()

  return {
    recordId,
    inputSummary: String(input.inputSummary || '').trim(),
    inputHash: String(input.inputHash || '').trim(),
    fraudType: String(input.fraudType || '未分类').trim(),
    riskLevel: normalizeRisk(input.riskLevel),
    rulesHit,
    modelUsed: String(input.modelUsed || '').trim(),
    latencyMs: input.latencyMs == null ? null : Number(input.latencyMs),
    alertSent: Boolean(input.alertSent),
    feedback: input.feedback == null ? null : String(input.feedback),
    source: String(input.source || 'local_agent').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
  }
}

export function createAnalysisRecord(input) {
  const item = normalizeRecord(input)
  try {
    insertAnalysisRecord(item)
  } catch (error) {
    if (String(error?.code || '').includes('SQLITE_CONSTRAINT')) {
      error.statusCode = 409
      error.message = `analysis record already exists: ${item.recordId}`
    }
    throw error
  }
  emitEvent('analysis_record_created', clone(item))
  return clone(item)
}

export function listAnalysisRecords(filters = {}) {
  return queryAnalysisRecords(filters)
}

export function getAnalysisRecordStats() {
  return queryAnalysisRecordStats()
}

