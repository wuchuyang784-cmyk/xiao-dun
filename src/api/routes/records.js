import {
  createAnalysisRecord,
  listAnalysisRecords,
  getAnalysisRecordStats,
  getAnalysisRecord,
} from '../../services/analysis-record-service.js'
import { jsonResponse, readJsonBody } from '../utils.js'
import { API_PATHS } from '../../services/api-contract.ts'

// 路径唯一真相源：api-contract.ts（契约检查器只放行该文件含版本前缀字面量）
const RECORDS = API_PATHS.analysis.records.list
const RECORDS_PREFIX = RECORDS + '/' // 带尾斜杠的前缀

export async function handleRecordRoutes(req, res, url) {
  // 统计（必须在 :id 通配之前）
  if (req.method === 'GET' && url.pathname === API_PATHS.analysis.records.stats) {
    jsonResponse(res, 200, { code: 0, message: 'success', data: getAnalysisRecordStats() })
    return true
  }

  // 列表（分页 + 过滤）
  if (req.method === 'GET' && url.pathname === RECORDS) {
    const data = listAnalysisRecords({
      analysisKind: url.searchParams.get('analysisKind') || '',
      subjectKind: url.searchParams.get('subjectKind') || '',
      toolName: url.searchParams.get('toolName') || '',
      analysisStatus: url.searchParams.get('analysisStatus') || '',
      provinceCode: url.searchParams.get('provinceCode') || '',
      riskLevel: url.searchParams.get('riskLevel') || '',
      channel: url.searchParams.get('channel') || '',
      dateFrom: url.searchParams.get('dateFrom') || '',
      dateTo: url.searchParams.get('dateTo') || '',
      keyword: url.searchParams.get('keyword') || '',
      page: url.searchParams.get('page') || 1,
      pageSize: url.searchParams.get('pageSize') || 20,
    })
    jsonResponse(res, 200, { code: 0, message: 'success', data })
    return true
  }

  // 详情（单段 id）
  if (req.method === 'GET' && url.pathname.startsWith(RECORDS_PREFIX)) {
    const recordId = decodeURIComponent(url.pathname.slice(RECORDS_PREFIX.length))
    if (recordId.includes('/')) {
      jsonResponse(res, 404, { code: 'RECORD_NOT_FOUND', message: 'analysis record not found' })
      return true
    }
    const item = getAnalysisRecord(recordId)
    if (!item) {
      jsonResponse(res, 404, { code: 'RECORD_NOT_FOUND', message: 'analysis record not found' })
      return true
    }
    jsonResponse(res, 200, { code: 0, message: 'success', data: item })
    return true
  }

  // App 上报一条分析备案（预留接口，等 App 接入即可直接写入）
  if (req.method === 'POST' && url.pathname === RECORDS) {
    try {
      const input = await readJsonBody(req, { maxBytes: 256 * 1024 })
      const item = createAnalysisRecord(input)
      jsonResponse(res, 201, { code: 0, message: 'created', data: item })
    } catch (error) {
      jsonResponse(res, error?.statusCode || 400, { code: 'INVALID_ANALYSIS_RECORD', message: error?.message || 'invalid analysis record' })
    }
    return true
  }

  return false
}
