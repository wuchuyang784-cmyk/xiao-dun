// ─── 定时提醒工具：scheduled_reminder ────────────────────────────────────────
// 控制反诈情报定时自动推送的开/关、模式（每日定时/间隔）、推送时间等。
// 配置文件：data/scheduled-reminder.json
// history 字段保留最近 10 条推送记录（环形缓冲）。

import fs from 'node:fs'
import path from 'node:path'

const DATA_DIR = path.resolve(process.cwd(), 'data')
const CFG_FILE = path.join(DATA_DIR, 'scheduled-reminder.json')
const HISTORY_LIMIT = 10

const DEFAULT_CONFIG = {
  enabled: false,                  // 默认关闭：避免用户无意识被骚扰
  mode: 'interval',                // 'interval' = 每 N 小时；'daily' = 每天 HH:MM
  daily_time: '09:00',             // daily 模式的目标时间（24h 制）
  interval_hours: 6,               // interval 模式的间隔
  history: [],                     // 最近推送记录
  last_run_at: null,               // 上次成功触发的时间（避免重复）
  created_at: null,
  updated_at: null,
}

// ─── 文件读写 ──────────────────────────────────────────────────────────────

function ensureDir() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }) } catch {}
}

function loadConfig() {
  try {
    if (!fs.existsSync(CFG_FILE)) return { ...DEFAULT_CONFIG }
    const raw = fs.readFileSync(CFG_FILE, 'utf-8')
    const cfg = JSON.parse(raw)
    return { ...DEFAULT_CONFIG, ...cfg, history: cfg.history || [] }
  } catch (err) {
    console.warn('[scheduled-reminder] 读取配置失败，使用默认值:', err.message)
    return { ...DEFAULT_CONFIG }
  }
}

function saveConfig(cfg) {
  ensureDir()
  cfg.updated_at = new Date().toISOString()
  if (!cfg.created_at) cfg.created_at = cfg.updated_at
  fs.writeFileSync(CFG_FILE, JSON.stringify(cfg, null, 2), 'utf-8')
  return cfg
}

function pushHistory(cfg, entry) {
  cfg.history.unshift({
    at: new Date().toISOString(),
    ...entry,
  })
  if (cfg.history.length > HISTORY_LIMIT) {
    cfg.history = cfg.history.slice(0, HISTORY_LIMIT)
  }
}

// ─── 校验与转换 ────────────────────────────────────────────────────────────

function parseDailyTime(s) {
  const m = String(s || '').trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

function parseInterval(s) {
  const n = Number(s)
  if (!Number.isFinite(n) || n < 1 || n > 24) return null
  return n
}

// ─── 格式化输出（给 LLM / 用户看的漂亮文本） ──────────────────────────────

export function formatStatus(cfg) {
  const lines = []
  lines.push('=== 定时反诈提醒 配置 ===')
  lines.push(`• 总开关: ${cfg.enabled ? '✅ 已开启' : '❌ 已关闭'}`)
  if (cfg.mode === 'daily') {
    lines.push(`• 模式: 每日定时 — 每天 ${cfg.daily_time} 自动推送`)
  } else {
    lines.push(`• 模式: 间隔采集 — 每 ${cfg.interval_hours} 小时推送一次`)
  }
  lines.push(`• 上次触发: ${cfg.last_run_at || '尚未触发'}`)
  if (cfg.history.length === 0) {
    lines.push('• 最近推送: 暂无记录')
  } else {
    lines.push(`• 最近推送记录（最多 ${HISTORY_LIMIT} 条）:`)
    cfg.history.slice(0, 5).forEach((h, i) => {
      const at = h.at?.replace('T', ' ').slice(0, 16) || '?'
      const tag = h.type === 'daily' ? '每日' : '间隔'
      lines.push(`  ${i + 1}. [${at}] ${tag} · 新增 ${h.new_count ?? 0} 条 · 推送 ${h.users ?? 0} 人 · ${h.status || 'ok'}`)
    })
  }
  return lines.join('\n')
}

// ─── 核心入口 ──────────────────────────────────────────────────────────────

export function execScheduledReminder(args = {}) {
  const action = String(args.action || 'status').trim().toLowerCase()
  const cfg = loadConfig()

  switch (action) {
    case 'status': {
      return toolJson({
        ok: true,
        action: 'status',
        enabled: cfg.enabled,
        mode: cfg.mode,
        daily_time: cfg.daily_time,
        interval_hours: cfg.interval_hours,
        last_run_at: cfg.last_run_at,
        recent_history: cfg.history.slice(0, 5),
        text: formatStatus(cfg),
      })
    }

    case 'enable': {
      cfg.enabled = true
      const out = saveConfig(cfg)
      return toolJson({
        ok: true, action: 'enable',
        enabled: true,
        text: `✅ 定时反诈提醒已开启。${cfg.mode === 'daily' ? `每天 ${cfg.daily_time}` : `每 ${cfg.interval_hours} 小时`} 自动采集并推送到已绑定的微信用户。`,
        config: out,
      })
    }

    case 'disable': {
      cfg.enabled = false
      const out = saveConfig(cfg)
      return toolJson({
        ok: true, action: 'disable',
        enabled: false,
        text: '⏸ 已关闭定时自动推送。下次需要时再用 /定时提醒 enable 开启。',
        config: out,
      })
    }

    case 'set_mode': {
      const m = String(args.mode || '').trim().toLowerCase()
      if (!['interval', 'daily'].includes(m)) {
        return toolJson({ ok: false, error: `mode 必须是 'interval' 或 'daily'，收到: ${args.mode}` }, false)
      }
      cfg.mode = m
      const out = saveConfig(cfg)
      return toolJson({
        ok: true, action: 'set_mode',
        mode: m,
        text: `已切换为${m === 'daily' ? '每日定时模式（' + cfg.daily_time + '）' : '间隔模式（每 ' + cfg.interval_hours + ' 小时）'}。`,
        config: out,
      })
    }

    case 'set_time': {
      const t = parseDailyTime(args.time || args.daily_time)
      if (!t) {
        return toolJson({ ok: false, error: `time 格式错误，应为 HH:MM（如 09:30），收到: ${args.time || args.daily_time}` }, false)
      }
      cfg.daily_time = t
      cfg.mode = 'daily'
      const out = saveConfig(cfg)
      return toolJson({
        ok: true, action: 'set_time',
        daily_time: t, mode: 'daily',
        text: `✅ 推送时间已设为每天 ${t}（同时切换为 daily 模式）。`,
        config: out,
      })
    }

    case 'set_interval': {
      const n = parseInterval(args.interval_hours ?? args.hours ?? args.interval)
      if (!n) {
        return toolJson({ ok: false, error: `interval_hours 必须是 1-24 的整数，收到: ${args.interval_hours ?? args.hours}` }, false)
      }
      cfg.interval_hours = n
      cfg.mode = 'interval'
      const out = saveConfig(cfg)
      return toolJson({
        ok: true, action: 'set_interval',
        interval_hours: n, mode: 'interval',
        text: `✅ 推送间隔已设为每 ${n} 小时（同时切换为 interval 模式）。`,
        config: out,
      })
    }

    case 'history': {
      return toolJson({
        ok: true, action: 'history',
        total: cfg.history.length,
        history: cfg.history,
        text: cfg.history.length === 0
          ? '尚无定时推送记录。开启 /定时提醒 后会在触发时记录。'
          : cfg.history.map((h, i) => {
              const at = h.at?.replace('T', ' ').slice(0, 16) || '?'
              return `${i + 1}. [${at}] ${h.type === 'daily' ? '每日' : '间隔'} · 新增 ${h.new_count ?? 0} 条 · 推送 ${h.users ?? 0} 人 · ${h.status || 'ok'}`
            }).join('\n'),
      })
    }

    default:
      return toolJson({
        ok: false,
        error: `未知 action: ${action}。可用: status / enable / disable / set_mode / set_time / set_interval / history`,
      }, false)
  }
}

// ─── 给 scheduler 用的内部接口（不同入口，模块复用） ──────────────────────

export function getReminderConfig() {
  return loadConfig()
}

export function recordReminderRun(entry) {
  const cfg = loadConfig()
  pushHistory(cfg, entry)
  cfg.last_run_at = new Date().toISOString()
  saveConfig(cfg)
}

// ─── 工具 JSON 包装器 ──────────────────────────────────────────────────────

function toolJson(obj, ok = true) {
  return JSON.stringify({ ...obj, ok })
}

export const __test__ = { loadConfig, saveConfig, pushHistory, parseDailyTime, parseInterval }
