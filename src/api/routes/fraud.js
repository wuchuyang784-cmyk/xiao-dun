import {
  getFraudCase,
  getFraudCases,
  getFraudStats,
  createFraudCase,
  importFraudCases,
  startImportJob,
  getImportJob,
} from '../../services/fraud-case-service.js'
import { jsonResponse, readJsonBody } from '../utils.js'
import { API_PATHS } from '../../services/api-contract.ts'

// ????????api-contract.ts?????????????????????
const CASES = API_PATHS.fraud.cases.list
const CASES_PREFIX = CASES + '/' // ???????
const IMPORT_JOBS_PREFIX = API_PATHS.fraud.cases.importJobs('') // ????????

export async function handleFraudRoutes(req, res, url) {
  if (req.method === 'GET' && url.pathname === CASES) {
    jsonResponse(res, 200, {
      code: 0,
      message: 'success',
      data: { cases: getFraudCases({ provinceCode: url.searchParams.get('provinceCode') || '', limit: url.searchParams.get('limit') }) },
    })
    return true
  }

  // ?????? :id ?????
  if (req.method === 'GET' && url.pathname === API_PATHS.fraud.cases.stats) {
    jsonResponse(res, 200, { code: 0, message: 'success', data: getFraudStats() })
    return true
  }

  // ?????????? :id ?????
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
    // ????? id????????
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

  // ????????? 1w+ ?????? jobId???????
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

  return false
}
