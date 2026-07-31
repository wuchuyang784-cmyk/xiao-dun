import { emitEvent } from '../events.js'
import { getFraudCaseStore } from '../db/stores/store-factory.js'
// 旧字段临时桥接：markCaseIndexed / getPendingIndexCases 在 pgvector 迁移后移除
import { markCaseIndexed, getPendingIndexCases } from '../db/repositories/fraud-cases.js'

// 顶层 await 获取 store（ESM 支持，importer 自动等待）
const store = await getFraudCaseStore()

// ─────────────────────────────────────────────────────────────
// RAG 接入 seam（端口/适配器）
//
// 数据库是案例的「系统真实源」；RAG 向量库是「语义检索层」。
// 二者通过 CaseIndexer 接口解耦：现在用 NoopIndexer 顶着（导入只写库、
// 不真正建向量），等 RAG 成员确定框架并实现适配器后，只需把
// RAG_PROVIDER 指向真实适配器即可，业务代码一行不改。
//
// 交接给 RAG 成员的契约：
//   1) FraudCase DTO 字段（caseId/provinceCode/fraudType/riskLevel/
//      content/summary/reviewStatus...）
//   2) CaseIndexer 接口：index(case) / bulkIndex(cases) / remove(caseId)
//      / search(queryEmbedding, topK) —— 适配器内部自行调用 Embedding 服务
//   3) 增量：订阅 SSE 事件 fraud_case_created / fraud_case_updated
//      全量：GET /fraud-cases?limit=100000 拉取后调 reindex
// ─────────────────────────────────────────────────────────────

/**
 * @typedef {Object} FraudCase
 * @property {string} caseId
 * @property {string} provinceCode
 * @property {string} fraudType
 * @property {'low'|'medium'|'high'|'critical'} riskLevel
 * @property {string} content      // 用于生成向量
 * @property {string} [summary]
 * @property {string} [reviewStatus]
 */

/**
 * RAG 向量索引器接口（依赖抽象，不依赖具体框架）
 * @typedef {Object} CaseIndexer
 * @property {(c: FraudCase) => Promise<void>} index
 * @property {(cases: FraudCase[]) => Promise<void>} bulkIndex
 * @property {(caseId: string) => Promise<void>} remove
 * @property {(queryEmbedding: number[], topK?: number) => Promise<Array<{caseId:string, score:number}>>} search
 */

/** 默认空实现：导入只写库，不真正建向量。RAG 成员实现真实适配器后替换。 */
const NoopIndexer = {
  async index() {},
  async bulkIndex() {},
  async remove() {},
  async search() { return [] },
}

export function createIndexer(provider = process.env.RAG_PROVIDER || 'noop') {
  if (!provider || provider === 'noop') return NoopIndexer
  // 未来由 RAG 成员在此返回 qdrant / pgvector 等适配器：
  //   if (provider === 'qdrant') return createQdrantIndexer(...)
  console.warn(`[fraud-case-service] 未知的 RAG_PROVIDER=${provider}，回退到 NoopIndexer`)
  return NoopIndexer
}

const indexer = createIndexer()

// 索引失败不应阻断数据库写入：仅记录并保留 vector_indexed=0 以便回填重试
function indexCaseQuietly(item) {
  Promise.resolve()
    .then(() => indexer.index(item))
    .then(() => markCaseIndexed(item.caseId))
    .catch((err) => console.warn('[fraud-case-service] index failed:', err?.message || err))
}

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

const provinceByCode = new Map(PROVINCES.map(([provinceCode, provinceName]) => [provinceCode, provinceName]))
const SUPPORTED_RISKS = ['low', 'medium', 'high', 'critical']
const DEMO_CASES = [
  { caseId: 'case_demo_001', provinceCode: '440000', longitude: 113.2644, latitude: 23.1291, fraudType: '冒充客服', riskLevel: 'high', lossAmount: 56000, status: 'active', occurredAt: '2026-07-28T00:00:00.000Z', summary: '冒充电商平台客服，以退款理赔为由诱导转账。' },
  { caseId: 'case_demo_002', provinceCode: '320000', longitude: 118.7969, latitude: 32.0603, fraudType: '刷单返利', riskLevel: 'medium', lossAmount: 18000, status: 'active', occurredAt: '2026-07-27T23:47:00.000Z', summary: '以兼职刷单返利为诱饵，要求连续垫付资金。' },
  { caseId: 'case_demo_003', provinceCode: '110000', longitude: 116.4074, latitude: 39.9042, fraudType: '虚假投资', riskLevel: 'high', lossAmount: 128000, status: 'processing', occurredAt: '2026-07-27T23:25:00.000Z', summary: '通过虚假投资平台诱导受害人追加保证金。' },
  { caseId: 'case_demo_004', provinceCode: '510000', longitude: 104.0665, latitude: 30.5728, fraudType: '冒充公检法', riskLevel: 'low', lossAmount: 6000, status: 'closed', occurredAt: '2026-07-27T23:13:00.000Z', summary: '冒充公检法工作人员要求配合资金审查。' },
  { caseId: 'case_demo_005', provinceCode: '420000', longitude: 114.3054, latitude: 30.5931, fraudType: '网络贷款', riskLevel: 'medium', lossAmount: 23000, status: 'active', occurredAt: '2026-07-27T23:01:00.000Z', summary: '以低息贷款为名收取手续费和解冻费。' },
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeRisk(value) {
  const risk = String(value ?? 'medium').trim().toLowerCase()
  if (!SUPPORTED_RISKS.includes(risk)) {
    throw new Error(`riskLevel must be one of: ${SUPPORTED_RISKS.join(', ')}`)
  }
  return risk
}

function normalizeCase(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('fraud case must be an object')
  }

  const caseId = String(input.caseId || `case_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`).trim()
  const provinceCode = String(input.provinceCode || '').trim()
  if (!provinceByCode.has(provinceCode)) {
    throw new Error('provinceCode must be a supported province code')
  }

  const occurredAt = input.occurredAt || new Date().toISOString()
  const parsedOccurredAt = new Date(occurredAt)
  if (Number.isNaN(parsedOccurredAt.getTime())) throw new Error('occurredAt must be a valid date')

  const summary = String(input.summary || '').trim()
  const fraudType = String(input.fraudType || '未分类诈骗').trim()
  const content = String(input.content || summary || `${fraudType} ${summary}`).trim()

  const item = {
    caseId,
    provinceCode,
    provinceName: provinceByCode.get(provinceCode),
    longitude: Number(input.longitude),
    latitude: Number(input.latitude),
    fraudType,
    riskLevel: normalizeRisk(input.riskLevel),
    lossAmount: Number(input.lossAmount ?? 0),
    status: String(input.status || 'active').trim(),
    occurredAt: parsedOccurredAt.toISOString(),
    summary,
    content,
    reviewStatus: String(input.reviewStatus || 'approved').trim(),
    version: Number(input.version || 1),
    source: String(input.source || '').trim(),
  }

  if (!item.caseId) throw new Error('caseId is required')
  if (!Number.isFinite(item.longitude) || item.longitude < -180 || item.longitude > 180) {
    throw new Error('longitude must be a valid number between -180 and 180')
  }
  if (!Number.isFinite(item.latitude) || item.latitude < -90 || item.latitude > 90) {
    throw new Error('latitude must be a valid number between -90 and 90')
  }
  if (!Number.isFinite(item.lossAmount) || item.lossAmount < 0) {
    throw new Error('lossAmount must be a non-negative number')
  }
  return item
}

function seedDemoCases() {
  for (const input of DEMO_CASES) {
    try {
      store.insert(normalizeCase(input))
    } catch (error) {
      console.warn('[fraud-case-service] demo seed skipped:', error.message)
    }
  }
}

seedDemoCases()

export function getFraudProvinceSnapshot() {
  const statistics = store.getProvinceStatistics()
  return {
    type: 'fraud_statistics_snapshot',
    version: 1,
    generatedAt: new Date().toISOString(),
    provinces: PROVINCES.map(([provinceCode, provinceName]) => statistics.get(provinceCode) || {
      provinceCode,
      provinceName,
      caseCount: 0,
      highRiskCount: 0,
      pendingCount: 0,
      totalLossAmount: 0,
    }),
  }
}

export function getFraudCases({ provinceCode = '', limit = 30 } = {}) {
  const normalizedLimit = Math.min(100000, Math.max(1, Number(limit) || 30))
  return store.list({ provinceCode: String(provinceCode || '').trim(), limit: normalizedLimit }).map(clone)
}

export function getFraudStats() {
  const total = store.count()
  const pending = store.pendingIndexCount()
  return { total, pending, indexed: Math.max(0, total - pending) }
}

export function createFraudCase(input) {
  const item = normalizeCase(input)
  try {
    store.insert(item)
  } catch (error) {
    if (String(error?.code || '').includes('SQLITE_CONSTRAINT')) {
      error.statusCode = 409
      error.message = `fraud case already exists: ${item.caseId}`
    }
    throw error
  }
  emitEvent('fraud_case_created', clone(item))
  indexCaseQuietly(item)
  return clone(item)
}

export function importFraudCases(payload) {
  const inputCases = Array.isArray(payload) ? payload : payload?.cases
  if (!Array.isArray(inputCases)) throw new Error('import payload must be an array or an object with a cases array')

  const result = { total: inputCases.length, inserted: 0, updated: 0, failed: 0 }
  const items = []
  for (let index = 0; index < inputCases.length; index += 1) {
    try {
      const item = normalizeCase(inputCases[index])
      const operation = store.upsert(item)
      result[operation.created ? 'inserted' : 'updated'] += 1
      items.push(item)
      emitEvent('fraud_case_created', clone(item))
    } catch (error) {
      result.failed += 1
      items.push({ index, caseId: inputCases[index]?.caseId || '', message: error?.message || 'invalid fraud case' })
    }
  }

  emitEvent('fraud_statistics_changed', getFraudProvinceSnapshot())
  return { summary: result, items: items.filter((x) => x?.caseId === undefined || x?.message) }
}

export function getFraudCase(caseId) {
  return clone(store.getById(String(caseId || '').trim()))
}

// ─────────────────────────────────────────────────────────────
// 异步导入任务（支撑 1w+ 案例批量导入，避免 HTTP 超时）
// 通过轮询 GET /fraud-cases/import-jobs/:id 获取进度
// ─────────────────────────────────────────────────────────────
const importJobs = new Map()

function jobSnapshot(job) {
  return {
    jobId: job.jobId,
    kind: job.kind,
    status: job.status,
    total: job.total,
    processed: job.processed,
    inserted: job.inserted,
    updated: job.updated,
    failed: job.failed,
    error: job.error || null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  }
}

export function startImportJob(payload) {
  const jobId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const job = {
    jobId, kind: 'import',
    status: 'running', total: 0, processed: 0,
    inserted: 0, updated: 0, failed: 0, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
  }
  importJobs.set(jobId, job)

  Promise.resolve().then(async () => {
    try {
      const inputCases = Array.isArray(payload) ? payload : payload?.cases
      if (!Array.isArray(inputCases)) throw new Error('import payload must be an array or {cases:[...]}')
      job.total = inputCases.length
      emitEvent('fraud_import_progress', jobSnapshot(job))

      const BATCH = 200
      for (let i = 0; i < inputCases.length; i += BATCH) {
        const slice = inputCases.slice(i, i + BATCH)
        const items = []
        for (let j = 0; j < slice.length; j += 1) {
          try {
            items.push(normalizeCase(slice[j]))
          } catch (err) {
            job.failed += 1
            console.warn(`[fraud-case-service] row ${i + j} skipped:`, err.message)
          }
        }
        for (const it of items) {
          const op = store.upsert(it)
          job[op.created ? 'inserted' : 'updated'] += 1
        }
        if (items.length) {
          try {
            await store.bulkIndex(items)
          } catch (err) {
            console.warn('[fraud-case-service] bulk index failed:', err?.message || err)
          }
        }
        job.processed = Math.min(i + BATCH, inputCases.length)
        emitEvent('fraud_import_progress', jobSnapshot(job))
      }
      job.status = 'done'
    } catch (err) {
      job.status = 'error'
      job.error = err?.message || String(err)
    } finally {
      job.finishedAt = new Date().toISOString()
      emitEvent('fraud_import_done', jobSnapshot(job))
      emitEvent('fraud_statistics_changed', getFraudProvinceSnapshot())
    }
  }).catch((err) => {
    job.status = 'error'
    job.error = err?.message || String(err)
    job.finishedAt = new Date().toISOString()
    emitEvent('fraud_import_done', jobSnapshot(job))
  })

  return { jobId, total: job.total }
}

export function getImportJob(jobId) {
  const job = importJobs.get(String(jobId || ''))
  return job ? jobSnapshot(job) : null
}

// ─────────────────────────────────────────────────────────────
// RAG 回填任务：把 vector_indexed=0 的案例交给 RAG 建向量（或 force 全量）
// ─────────────────────────────────────────────────────────────
export function startReindexJob({ force = false } = {}) {
  const jobId = `rix_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const job = {
    jobId, kind: 'reindex',
    status: 'running', total: 0, processed: 0,
    inserted: 0, updated: 0, failed: 0, error: null,
    startedAt: new Date().toISOString(), finishedAt: null,
  }
  importJobs.set(jobId, job)

  Promise.resolve().then(async () => {
    try {
      const cases = force ? store.list({ limit: 100000 }) : getPendingIndexCases(100000)
      job.total = cases.length
      emitEvent('fraud_import_progress', jobSnapshot(job))

      const BATCH = 200
      for (let i = 0; i < cases.length; i += BATCH) {
        const slice = cases.slice(i, i + BATCH)
        try {
          await store.bulkIndex(slice.map((c) => ({ ...c })))
          job.inserted += slice.length
        } catch (err) {
          job.failed += slice.length
          console.warn('[fraud-case-service] reindex batch failed:', err?.message || err)
        }
        job.processed = Math.min(i + BATCH, cases.length)
        emitEvent('fraud_import_progress', jobSnapshot(job))
      }
      job.status = 'done'
    } catch (err) {
      job.status = 'error'
      job.error = err?.message || String(err)
    } finally {
      job.finishedAt = new Date().toISOString()
      emitEvent('fraud_import_done', jobSnapshot(job))
      emitEvent('fraud_statistics_changed', getFraudProvinceSnapshot())
    }
  }).catch((err) => {
    job.status = 'error'
    job.error = err?.message || String(err)
    job.finishedAt = new Date().toISOString()
    emitEvent('fraud_import_done', jobSnapshot(job))
  })

  return { jobId, total: job.total }
}

export { indexer as caseIndexer }
