import {
  getFraudCase,
  getFraudCases,
  getFraudProvinceSnapshot,
  getFraudStats,
  createFraudCase,
  importFraudCases,
  startImportJob,
  getImportJob,
  startReindexJob,
} from '../../services/fraud-case-service.js'
import { jsonResponse, readJsonBody } from '../utils.js'
import { API_PATHS } from '../../services/api-contract.ts'

// 路径唯一真相源：api-contract.ts（契约检查器只放行该文件含版本前缀字面量）
const CASES = API_PATHS.fraud.cases.list
const CASES_PREFIX = CASES + '/' // 带尾斜杠的前缀
const IMPORT_JOBS_PREFIX = API_PATHS.fraud.cases.importJobs('') // 导入任务路径前缀

export async function handleFraudRoutes(req, res, url) {
  if (req.method === 'GET' && url.pathname === API_PATHS.fraud.statistics.provinces) {
    jsonResponse(res, 200, { code: 0, message: 'success', data: getFraudProvinceSnapshot() })
    return true
  }

  if (req.method === 'GET' && url.pathname === CASES) {
    jsonResponse(res, 200, {
      code: 0,
      message: 'success',
      data: { cases: getFraudCases({ provinceCode: url.searchParams.get('provinceCode') || '', limit: url.searchParams.get('limit') }) },
    })
    return true
  }

  // 统计（必须在 :id 通配之前）
  if (req.method === 'GET' && url.pathname === API_PATHS.fraud.cases.stats) {
    jsonResponse(res, 200, { code: 0, message: 'success', data: getFraudStats() })
    return true
  }

  // 导入任务进度（必须在 :id 通配之前）
  if (req.method === 'GET' && url.pathname.startsWith(IMPORT_JOBS_PREFIX)) {
    const jobId = decodeURIComponent(url.pathname.slice(IMPORT_JOBS_PREFIX.length))
    const job = getImportJob(jobId)
    if (!job) {
      jsonResponse(res, 404, { code: 'JOB_NOT_FOUND', message: 'import job not found' })
      return true
    }
    jsonResponse(res, 200, { code: 0, message: 'success', data: job })
    return true
  }

  if (req.method === 'GET' && url.pathname.startsWith(CASES_PREFIX)) {
    const caseId = decodeURIComponent(url.pathname.slice(CASES_PREFIX.length))
    // 仅匹配单段 id，避免吞掉子路由
    if (caseId.includes('/')) {
      jsonResponse(res, 404, { code: 'FRAUD_CASE_NOT_FOUND', message: 'fraud case not found' })
      return true
    }
    const item = getFraudCase(caseId)
    if (!item) {
      jsonResponse(res, 404, { code: 'FRAUD_CASE_NOT_FOUND', message: 'fraud case not found' })
      return true
    }
    jsonResponse(res, 200, { code: 0, message: 'success', data: item })
    return true
  }

  if (req.method === 'POST' && url.pathname === API_PATHS.fraud.cases.import) {
    try {
      const input = await readJsonBody(req, { maxBytes: 4 * 1024 * 1024 })
      const result = importFraudCases(input)
      jsonResponse(res, 200, { code: 0, message: 'imported', data: result })
    } catch (error) {
      jsonResponse(res, error?.statusCode || 400, { code: 'INVALID_FRAUD_CASE_IMPORT', message: error?.message || 'invalid fraud case import' })
    }
    return true
  }

  if (req.method === 'POST' && url.pathname === CASES) {
    try {
      const input = await readJsonBody(req, { maxBytes: 256 * 1024 })
      const item = createFraudCase(input)
      jsonResponse(res, 201, { code: 0, message: 'created', data: item })
    } catch (error) {
      jsonResponse(res, error?.statusCode || 400, { code: 'INVALID_FRAUD_CASE', message: error?.message || 'invalid fraud case' })
    }
    return true
  }

  // 异步批量导入（支撑 1w+ 案例）：返回 jobId，前端轮询进度
  if (req.method === 'POST' && url.pathname === API_PATHS.fraud.cases.importAsync) {
    try {
      const input = await readJsonBody(req, { maxBytes: 64 * 1024 * 1024 })
      const { jobId, total } = startImportJob(input)
      jsonResponse(res, 202, { code: 0, message: 'import started', data: { jobId, total } })
    } catch (error) {
      jsonResponse(res, error?.statusCode || 400, { code: 'INVALID_FRAUD_CASE_IMPORT', message: error?.message || 'invalid fraud case import' })
    }
    return true
  }

  // RAG 回填：把未索引（或 force 全量）案例交给 RAG 建向量
  if (req.method === 'POST' && url.pathname === API_PATHS.fraud.cases.reindex) {
    try {
      const body = await readJsonBody(req).catch(() => ({}))
      const { jobId, total } = startReindexJob({ force: body?.force === true })
      jsonResponse(res, 202, { code: 0, message: 'reindex started', data: { jobId, total } })
    } catch (error) {
      jsonResponse(res, error?.statusCode || 400, { code: 'REINDEX_FAILED', message: error?.message || 'reindex failed' })
    }
    return true
  }

  return false
}
