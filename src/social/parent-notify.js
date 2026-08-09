// parent-notify.js —— 家长微信风险定向推送服务
import crypto from 'node:crypto'
import { getDB, getAllClawbotTokens } from '../db.js'
import { dispatchSocialMessage } from './dispatch.js'
import {
  upsertBinding,
  getBinding as getBindingRow,
  removeBinding,
  removeBindingsByParent,
} from '../db/repositories/bindings.js'

export const RISK_PUSH_THRESHOLD = 50
export const PUSH_DEDUP_MS = 600_000
const CLAWBOT_PREFIX = 'wechat:clawbot:'
const dedupMap = new Map()

export function getMyClawbotId(msg = {}) {
  const raw = String(msg?.externalPartyId || msg?.fromId || '').trim()
  if (!raw) return ''
  if (raw.startsWith(CLAWBOT_PREFIX)) return raw.slice(CLAWBOT_PREFIX.length)
  return raw
}

export function bindParent(childId, parentId, { relation = 'parent', status = 'active' } = {}) {
  if (!childId || !parentId) {
    throw new Error('bindParent 需要 childId 与 parentId')
  }
  return upsertBinding(String(childId), String(parentId), { relation, status })
}

export function getBinding(childId) {
  if (!childId) return null
  return getBindingRow(String(childId))
}

export function unbindParent(id) {
  if (!id) return false
  const childDeleted = removeBinding(String(id))
  const parentDeleted = removeBindingsByParent(String(id))
  return childDeleted || parentDeleted > 0
}

function dedupKey(childWechatId, p = {}) {
  const seed = [p.score, p.level, p.kind, p.fraudType, p.subjectRef]
    .map(v => (v == null ? '' : String(v)))
    .join('|')
  const hash = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16)
  return `${childWechatId}:${hash}`
}

function buildParentPushText({ level = '', score = 0, fraudType = '', summary = '' } = {}) {
  const lvl = String(level || '中高危').replace('高危钓鱼', '高风险')
  const type = String(fraudType || '未知类型')
  const sum = String(summary || '').slice(0, 40)
  return `【小盾·风险通知】您绑定的子女账号触发中高危风险：${lvl}(${score})｜类型：${type}｜摘要：${sum}，请注意提醒子女。`
}

function pruneDedup(now) {
  if (dedupMap.size <= 256) return
  for (const [key, ts] of dedupMap) {
    if (now - ts >= PUSH_DEDUP_MS) dedupMap.delete(key)
  }
}

export async function maybeNotifyBoundParent(childWechatId, {
  score = 0,
  level = '',
  kind = '',
  fraudType = '',
  summary = '',
  subjectRef = '',
  recordId = '',
} = {}) {
  if (Number(score) < RISK_PUSH_THRESHOLD) {
    return { notified: false, reason: 'below_threshold' }
  }
  const binding = getBinding(String(childWechatId))
  if (!binding || binding.status !== 'active') {
    return { notified: false, reason: 'no_binding' }
  }
  const key = dedupKey(String(childWechatId), { score, level, kind, fraudType, subjectRef })
  const now = Date.now()
  const last = dedupMap.get(key)
  if (last != null && now - last < PUSH_DEDUP_MS) {
    return { notified: false, reason: 'dedup_skipped' }
  }
  const onlineParentIds = new Set(
    (getAllClawbotTokens() || []).map(t => String(t.from_user_id))
  )
  if (!onlineParentIds.has(String(binding.parentWechatId))) {
    return { notified: false, reason: 'parent_offline' }
  }
  const text = buildParentPushText({ level, score, fraudType, summary })
  try {
    const r = await dispatchSocialMessage(`wechat:clawbot:${binding.parentWechatId}`, { text })
    if (r && r.ok === false) {
      return { notified: false, reason: r.reason || r.error || 'dispatch_rejected' }
    }
  } catch (err) {
    return { notified: false, reason: `push_error:${err?.message || 'unknown'}` }
  }
  dedupMap.set(key, now)
  pruneDedup(now)
  if (recordId) markAlertSent(String(recordId))
  return { notified: true, reason: 'ok' }
}

function markAlertSent(recordId) {
  if (!recordId) return
  try {
    getDB().prepare(
      `UPDATE analysis_records SET alert_sent = 1 WHERE record_id = ?`
    ).run(recordId)
  } catch {}
}
