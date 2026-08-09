// bindings.js —— 家长-子女微信绑定仓储
import { getDB } from '../connection.js'

function toBinding(row) {
  if (!row) return null
  return {
    childWechatId: row.child_wechat_id,
    parentWechatId: row.parent_wechat_id,
    relation: row.relation,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function upsertBinding(childWechatId, parentWechatId, { relation = 'parent', status = 'active' } = {}) {
  if (!childWechatId || !parentWechatId) {
    throw new Error('upsertBinding 需要 childWechatId 与 parentWechatId')
  }
  getDB().prepare(`
    INSERT INTO parent_bindings (
      child_wechat_id, parent_wechat_id, relation, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(child_wechat_id) DO UPDATE SET
      parent_wechat_id = excluded.parent_wechat_id,
      relation         = excluded.relation,
      status           = excluded.status,
      updated_at       = datetime('now')
  `).run(String(childWechatId), String(parentWechatId), String(relation), String(status))
  return getBinding(String(childWechatId))
}

export function getBinding(childWechatId) {
  if (!childWechatId) return null
  return toBinding(getDB().prepare(
    `SELECT * FROM parent_bindings WHERE child_wechat_id = ?`
  ).get(String(childWechatId)))
}

export function removeBinding(childWechatId) {
  if (!childWechatId) return false
  return getDB().prepare(
    `DELETE FROM parent_bindings WHERE child_wechat_id = ?`
  ).run(String(childWechatId)).changes > 0
}

export function removeBindingsByParent(parentWechatId) {
  if (!parentWechatId) return 0
  return getDB().prepare(
    `DELETE FROM parent_bindings WHERE parent_wechat_id = ?`
  ).run(String(parentWechatId)).changes
}

export function listBindings() {
  const rows = getDB().prepare(
    `SELECT * FROM parent_bindings ORDER BY updated_at DESC`
  ).all()
  return rows.map(toBinding)
}
