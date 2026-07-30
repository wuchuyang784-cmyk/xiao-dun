import { emitEvent } from '../events.js'
import {
  insertAnalysisRecord,
  getAnalysisRecordById,
  listAnalysisRecords as queryAnalysisRecords,
  getAnalysisRecordStats as queryAnalysisRecordStats,
} from '../db/repositories/analysis-records.js'

// ─────────────────────────────────────────────────────────────
// AI 分析备案服务
//
// 作用：App 端每次调用 AI 分析（反诈骗识别）都上报一条备案记录，
// 供管理人员审计、回溯与统计。目前 App 尚未开发，这里先预留
// createAnalysisRecord 作为接收契约，接口与字段已稳定。
//
// App 上报契约（POST /analysis-records）：
//   {
//     recordId?     唯一幂等键（不传则服务端生成）
//     userId        脱敏后的用户标识
//     deviceId      设备标识
//     provinceCode  省份代码（可选，空则记为“未知”）
//     provinceName  省份名（可选，缺省按 code 推导）
//     channel       来源渠道：wechat / app（默认 app）
//     inputSummary  脱敏后的消息摘要（不存原文）
//     inputHash     内容指纹（可选，用于去重）
//     fraudType     命中诈骗类型
//     riskLevel     low|medium|high|critical
//     rulesHit      命中的规则 id 数组
//     modelUsed     使用的模型名
//     latencyMs     分析耗时（毫秒）
//     alertSent     是否触发了主动告警
//     feedback      用户反馈（可选）
//   }
// ─────────────────────────────────────────────────────────────

const PROVINCES = [
  ['110000', '北京市'], ['120000', '天津市'], ['130000', '河北省'], ['140000', '山西省'],
  ['150000', '内蒙古自治区'], ['210000', '辽宁省'], ['220000', '吉林省'], ['230000', '黑龙江省'],
  ['310000', '上海市'], ['320000', '江苏省'], ['330000', '浙江省'], ['340000', '安徽省'],
  ['350000', '福建省'], ['360000', '江西省'], ['370000', '山东省'], ['410000', '河南省'],
  ['420000', '湖北省'], ['430000', '湖南省'], ['440000', '广东省'], ['450000', '广西壮族自治区'],
  ['460000', '海南省'], ['500000', '重庆市'], ['510000', '四川省'], ['520000', '贵州省'],
  ['530000', '云南省'], ['540000', '西藏自治区'], ['610000', '陕西省'], ['620000', '甘肃省'],
  ['630000', '青海省'], ['640000', '宁夏回族自治区'], ['650000', '新疆维吾尔自治区'],
  ['710000', '台湾省'], ['810000', '香港特别行政区'], ['820000', '澳门特别行政区'],
]
const provinceByCode = new Map(PROVINCES.map(([code, name]) => [code, name]))
const SUPPORTED_RISKS = ['low', 'medium', 'high', 'critical']
const SUPPORTED_CHANNELS = ['wechat', 'app', 'web', 'unknown']

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
  const provinceCode = String(input.provinceCode || '').trim()
  let provinceName = String(input.provinceName || '').trim()
  if (provinceCode && provinceByCode.has(provinceCode)) {
    provinceName = provinceByCode.get(provinceCode)
  } else if (!provinceName) {
    provinceName = provinceCode ? '未知' : '未知'
  }

  const channel = String(input.channel || 'app').trim().toLowerCase()
  if (!SUPPORTED_CHANNELS.includes(channel)) {
    throw new Error(`channel must be one of: ${SUPPORTED_CHANNELS.join(', ')}`)
  }

  let rulesHit = input.rulesHit
  if (typeof rulesHit === 'string') {
    try { rulesHit = JSON.parse(rulesHit) } catch { rulesHit = [] }
  }
  if (!Array.isArray(rulesHit)) rulesHit = []

  const recordId = String(input.recordId || `rec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`).trim()

  return {
    recordId,
    userId: String(input.userId || '').trim(),
    deviceId: String(input.deviceId || '').trim(),
    provinceCode,
    provinceName,
    channel,
    inputSummary: String(input.inputSummary || '').trim(),
    inputHash: String(input.inputHash || '').trim(),
    fraudType: String(input.fraudType || '未分类').trim(),
    riskLevel: normalizeRisk(input.riskLevel),
    rulesHit,
    modelUsed: String(input.modelUsed || '').trim(),
    latencyMs: input.latencyMs == null ? null : Number(input.latencyMs),
    alertSent: Boolean(input.alertSent),
    feedback: input.feedback == null ? null : String(input.feedback),
    source: String(input.source || 'app').trim(),
    createdAt: input.createdAt || new Date().toISOString(),
  }
}

// 演示数据：App 未开发时让面板有内容可看（幂等写入，重复启动不重复）
const DEMO_RECORDS = [
  { userId: 'u_demo_001', provinceCode: '440000', channel: 'wechat', inputSummary: '客服说退款要扫码，是不是诈骗？', fraudType: '冒充客服', riskLevel: 'high', rulesHit: ['r_impersonate_cs', 'r_refund_scan'], modelUsed: 'qwen2.5-7b', latencyMs: 820, alertSent: true },
  { userId: 'u_demo_002', provinceCode: '320000', channel: 'wechat', inputSummary: '兼职刷单返利先垫付后返现', fraudType: '刷单返利', riskLevel: 'medium', rulesHit: ['r_brushing'], modelUsed: 'qwen2.5-7b', latencyMs: 640, alertSent: false },
  { userId: 'u_demo_003', provinceCode: '110000', channel: 'app', inputSummary: '收到“公检法”配合资金审查通知', fraudType: '冒充公检法', riskLevel: 'critical', rulesHit: ['r_police_impersonate'], modelUsed: 'deepseek-7b', latencyMs: 910, alertSent: true },
  { userId: 'u_demo_004', provinceCode: '510000', channel: 'wechat', inputSummary: '朋友推荐内部投资平台稳赚', fraudType: '虚假投资', riskLevel: 'high', rulesHit: ['r_invest_platform'], modelUsed: 'qwen2.5-7b', latencyMs: 770, alertSent: true },
  { userId: 'u_demo_005', provinceCode: '420000', channel: 'app', inputSummary: '低息贷款要先交手续费', fraudType: '网络贷款', riskLevel: 'low', rulesHit: ['r_loan_fee'], modelUsed: 'qwen2.5-7b', latencyMs: 580, alertSent: false },
]

function seedDemoRecords() {
  for (const input of DEMO_RECORDS) {
    try {
      insertAnalysisRecord(normalizeRecord(input), { ignoreConflict: true })
    } catch (error) {
      console.warn('[analysis-record-service] demo seed skipped:', error.message)
    }
  }
}

seedDemoRecords()

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

export function getAnalysisRecord(recordId) {
  return clone(getAnalysisRecordById(String(recordId || '').trim()))
}
