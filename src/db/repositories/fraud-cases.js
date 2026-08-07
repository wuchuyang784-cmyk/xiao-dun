import { getDB } from '../connection.js'

function toCase(row) {
  if (!row) return null
  return {
    caseId: row.case_id,
    provinceCode: row.province_code,
    provinceName: row.province_name,
    longitude: row.longitude,
    latitude: row.latitude,
    fraudType: row.fraud_type,
    riskLevel: row.risk_level,
    lossAmount: row.loss_amount,
    status: row.status,
    occurredAt: row.occurred_at,
    summary: row.summary,
    content: row.content || '',
    reviewStatus: row.review_status || 'approved',
    version: row.version || 1,
    source: row.source || '',
    vectorIndexed: Number(row.vector_indexed || 0) === 1,
    indexedAt: row.indexed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const insertSql = `
  INSERT INTO fraud_cases (
    case_id, province_code, province_name, longitude, latitude,
    fraud_type, risk_level, loss_amount, status, occurred_at,
    summary, content, review_status, version, source, vector_indexed,
    created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
`

export function insertFraudCase(item, { ignoreConflict = false } = {}) {
  const db = getDB()
  const now = new Date().toISOString()
  const sql = ignoreConflict ? insertSql.replace('INSERT INTO', 'INSERT OR IGNORE INTO') : insertSql
  const result = db.prepare(sql).run(
    item.caseId,
    item.provinceCode,
    item.provinceName,
    item.longitude,
    item.latitude,
    item.fraudType,
    item.riskLevel,
    item.lossAmount,
    item.status,
    item.occurredAt,
    item.summary,
    item.content || '',
    item.reviewStatus || 'approved',
    item.version || 1,
    item.source || '',
    now,
    now,
  )
  return result.changes > 0
}

export function upsertFraudCase(item) {
  const db = getDB()
  const existing = db.prepare('SELECT case_id, created_at, vector_indexed FROM fraud_cases WHERE case_id = ?').get(item.caseId)
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO fraud_cases (
      case_id, province_code, province_name, longitude, latitude,
      fraud_type, risk_level, loss_amount, status, occurred_at,
      summary, content, review_status, version, source, vector_indexed,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
    ON CONFLICT(case_id) DO UPDATE SET
      province_code = excluded.province_code,
      province_name = excluded.province_name,
      longitude = excluded.longitude,
      latitude = excluded.latitude,
      fraud_type = excluded.fraud_type,
      risk_level = excluded.risk_level,
      loss_amount = excluded.loss_amount,
      status = excluded.status,
      occurred_at = excluded.occurred_at,
      summary = excluded.summary,
      content = excluded.content,
      review_status = excluded.review_status,
      version = excluded.version,
      source = excluded.source,
      updated_at = excluded.updated_at
  `).run(
    item.caseId, item.provinceCode, item.provinceName, item.longitude, item.latitude,
    item.fraudType, item.riskLevel, item.lossAmount, item.status, item.occurredAt,
    item.summary, item.content || '', item.reviewStatus || 'approved', item.version || 1, item.source || '',
    existing?.created_at || now, now,
  )
  return { created: !existing, updated: Boolean(existing) }
}

export function getFraudCaseById(caseId) {
  return toCase(getDB().prepare('SELECT * FROM fraud_cases WHERE case_id = ?').get(caseId))
}

export function listFraudCases({ provinceCode = '', limit = 30 } = {}) {
  const sql = provinceCode
    ? 'SELECT * FROM fraud_cases WHERE province_code = ? ORDER BY occurred_at DESC, id DESC LIMIT ?'
    : 'SELECT * FROM fraud_cases ORDER BY occurred_at DESC, id DESC LIMIT ?'
  const rows = provinceCode
    ? getDB().prepare(sql).all(provinceCode, limit)
    : getDB().prepare(sql).all(limit)
  return rows.map(toCase)
}

export function getFraudProvinceStatistics() {
  const rows = getDB().prepare(`
    SELECT
      province_code AS provinceCode,
      province_name AS provinceName,
      COUNT(*) AS caseCount,
      SUM(CASE WHEN risk_level IN ('high', 'critical') THEN 1 ELSE 0 END) AS highRiskCount,
      SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) AS pendingCount,
      COALESCE(SUM(loss_amount), 0) AS totalLossAmount
    FROM fraud_cases
    GROUP BY province_code, province_name
  `).all()
  return new Map(rows.map(row => [row.provinceCode, {
    provinceCode: row.provinceCode,
    provinceName: row.provinceName,
    caseCount: Number(row.caseCount || 0),
    highRiskCount: Number(row.highRiskCount || 0),
    pendingCount: Number(row.pendingCount || 0),
    totalLossAmount: Number(row.totalLossAmount || 0),
  }]))
}

export function markCaseIndexed(caseId) {
  getDB().prepare('UPDATE fraud_cases SET vector_indexed = 1, indexed_at = ? WHERE case_id = ?')
    .run(new Date().toISOString(), caseId)
}

export function getPendingIndexCases(limit = 100000) {
  return getDB().prepare('SELECT * FROM fraud_cases WHERE vector_indexed = 0 ORDER BY id ASC LIMIT ?')
    .all(limit).map(toCase)
}

export function countFraudCases() {
  return Number(getDB().prepare('SELECT COUNT(*) AS n FROM fraud_cases').get()?.n || 0)
}

export function countPendingIndex() {
  return Number(getDB().prepare('SELECT COUNT(*) AS n FROM fraud_cases WHERE vector_indexed = 0').get()?.n || 0)
}
