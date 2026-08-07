import { getDB } from '../connection.js'

function toRecord(row) {
  if (!row) return null
  let rules = []
  try { rules = JSON.parse(row.rules_hit || '[]') } catch { rules = [] }
  return {
    recordId: row.record_id,
    inputSummary: row.input_summary,
    inputHash: row.input_hash,
    fraudType: row.fraud_type,
    riskLevel: row.risk_level,
    rulesHit: rules,
    modelUsed: row.model_used,
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    alertSent: Number(row.alert_sent || 0) === 1,
    feedback: row.feedback || null,
    source: row.source || '',
    analysisKind: row.analysis_kind || '',
    subjectKind: row.subject_kind || '',
    subjectRef: row.subject_ref || '',
    toolName: row.tool_name || '',
    analysisStatus: row.analysis_status || '',
    failureReason: row.failure_reason || '',
    reportMarkdown: row.report_markdown || '',
    createdAt: row.created_at,
  }
}

const insertSql = `
  INSERT INTO analysis_records (
    record_id, input_summary, input_hash, fraud_type, risk_level,
    rules_hit, model_used, latency_ms, alert_sent, feedback, source,
    analysis_kind, subject_kind, subject_ref, tool_name, analysis_status, failure_reason, report_markdown,
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`

export function insertAnalysisRecord(item, { ignoreConflict = false } = {}) {
  const db = getDB()
  const sql = ignoreConflict ? insertSql.replace('INSERT INTO', 'INSERT OR IGNORE INTO') : insertSql
  const result = db.prepare(sql).run(
    item.recordId,
    item.inputSummary || '',
    item.inputHash || '',
    item.fraudType || '未分类',
    item.riskLevel || 'low',
    JSON.stringify(item.rulesHit || []),
    item.modelUsed || '',
    item.latencyMs == null ? null : Number(item.latencyMs),
    item.alertSent ? 1 : 0,
    item.feedback || null,
    item.source || '',
    item.analysisKind || '',
    item.subjectKind || '',
    item.subjectRef || '',
    item.toolName || '',
    item.analysisStatus || 'done',
    item.failureReason || '',
    item.reportMarkdown || '',
    item.createdAt || new Date().toISOString(),
  )
  return result.changes > 0
}

export function getAnalysisRecordById(recordId) {
  return toRecord(getDB().prepare('SELECT * FROM analysis_records WHERE record_id = ?').get(recordId))
}

/**
 * 查询分析记录：支持风险等级 / 时间范围 / 关键词 过滤 + 分页。
 */
export function listAnalysisRecords({
  analysisKind = '',
  subjectKind = '',
  toolName = '',
  analysisStatus = '',
  riskLevel = '',
  dateFrom = '',
  dateTo = '',
  keyword = '',
  page = 1,
  pageSize = 20,
} = {}) {
  const where = []
  const params = []
  if (analysisKind) { where.push('analysis_kind = ?'); params.push(analysisKind) }
  if (subjectKind) { where.push('subject_kind = ?'); params.push(subjectKind) }
  if (toolName) { where.push('tool_name = ?'); params.push(toolName) }
  if (analysisStatus) { where.push('analysis_status = ?'); params.push(analysisStatus) }
  if (riskLevel) { where.push('risk_level = ?'); params.push(riskLevel) }
  if (dateFrom) { where.push('created_at >= ?'); params.push(dateFrom) }
  if (dateTo) { where.push('created_at <= ?'); params.push(dateTo) }
  if (keyword) { where.push('(input_summary LIKE ? OR fraud_type LIKE ?)'); const k = `%${keyword}%`; params.push(k, k) }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const safePage = Math.max(1, Number(page) || 1)
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20))
  const offset = (safePage - 1) * safeSize

  const db = getDB()
  const rows = db.prepare(`SELECT * FROM analysis_records ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, safeSize, offset)
  const total = Number(db.prepare(`SELECT COUNT(*) AS n FROM analysis_records ${whereSql}`).get(...params)?.n || 0)

  return {
    records: rows.map(toRecord),
    page: safePage,
    pageSize: safeSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / safeSize)),
  }
}

/**
 * 统计：总量 / 今日 / 各风险等级计数（个人分析记录统计）。
 */
export function getAnalysisRecordStats() {
  const db = getDB()
  const overview = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN created_at >= date('now') THEN 1 ELSE 0 END) AS today,
      SUM(CASE WHEN risk_level IN ('high', 'critical') THEN 1 ELSE 0 END) AS highRisk,
      SUM(CASE WHEN alert_sent = 1 THEN 1 ELSE 0 END) AS alerted
    FROM analysis_records
  `).get()
  const byRisk = db.prepare(`
    SELECT risk_level AS riskLevel, COUNT(*) AS count
    FROM analysis_records GROUP BY risk_level
  `).all()
  const byKind = db.prepare(`
    SELECT analysis_kind AS analysisKind, COUNT(*) AS count
    FROM analysis_records GROUP BY analysis_kind
  `).all()
  return {
    total: Number(overview?.total || 0),
    today: Number(overview?.today || 0),
    highRisk: Number(overview?.highRisk || 0),
    alerted: Number(overview?.alerted || 0),
    byRisk: byRisk.map(r => ({ riskLevel: r.riskLevel, count: Number(r.count) })),
    byKind: byKind.map(r => ({ analysisKind: r.analysisKind || '', count: Number(r.count) })),
  }
}
