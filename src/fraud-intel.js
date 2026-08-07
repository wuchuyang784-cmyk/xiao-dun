/**
 * fraud-intel.js
 *
 * 诈骗案例与套路情报采集器。
 *
 * 定时从公开渠道采集最新骗局与手法，结构化存储，供：
 *   - LLM 工具 fraud_intel（主动调用查最新情报 / 推送给用户）
 *   - system prompt 注入（getFraudIntelBlock）
 *
 * 采集策略：
 *   1) Bing 搜索（无 key，HTML 解析）—— 按诈骗类型分组搜索最新案例
 *   2) 若配了 SERPER_API_KEY / BRAVE_API_KEY，优先用 JSON API（更稳定）
 *   3) 对前 N 条结果用 Jina Reader（r.jina.ai）提取正文摘要
 *
 * 缓存策略：6 小时内复用；可被 force=true 强制刷新。
 *
 * 对外接口：
 *   collectFraudIntel()    → async，采集并落盘
 *   getFraudIntelBlock()   → 同步，返回注入 prompt 的纯文本块
 *   getFraudIntelCache()   → 同步，返回原始缓存对象
 */

import fs from 'fs'
import path from 'path'
import { paths } from './paths.js'
import { emitEvent } from './events.js'
import { pushMessage } from './inbound-message.js'
import { getAllClawbotTokens } from './db.js'
import { dispatchSocialMessage } from './social/dispatch.js'
import { getReminderConfig, recordReminderRun } from './capabilities/tools/scheduled-reminder.js'

const INTEL_FILE     = path.join(paths.dataDir, 'fraud-intel.json')
const INTEL_VERSION  = 1
const INTEL_CACHE_MS = 6 * 60 * 60 * 1000  // 6 小时

let _cached = null

// ─── 工具函数 ──────────────────────────────────────────────────────────────────

function safe(fn, fallback = null) {
  try { return fn() } catch { return fallback }
}

const WEB_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
}

async function fetchText(url, options = {}, timeoutMs = 10000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, ...options })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function fetchJSON(url, options = {}, timeoutMs = 10000) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    const res = await fetch(url, { signal: ctrl.signal, ...options })
    clearTimeout(t)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ─── 诈骗类型分类（与 fraud-rule-engine 对齐） ──────────────────────────────────

const FRAUD_CATEGORIES = [
  { id: 'brushing',           type: '刷单返利',     query: '最新 刷单返利诈骗 警方通报 案例' },
  { id: 'refund_customer',    type: '冒充客服退款',  query: '最新 冒充客服退款诈骗 警方通报 案例' },
  { id: 'impersonate_police', type: '冒充公检法',   query: '最新 冒充公检法诈骗 警方通报 案例' },
  { id: 'fake_investment',    type: '虚假投资理财',  query: '最新 投资理财诈骗 警方通报 案例' },
  { id: 'pig_butchering',     type: '杀猪盘',       query: '最新 杀猪盘诈骗 警方通报 案例' },
  { id: 'loan_scam',          type: '贷款诈骗',     query: '最新 网贷贷款诈骗 警方通报 案例' },
  { id: 'prize_scam',         type: '中奖诈骗',     query: '最新 中奖诈骗 警方通报 案例' },
  { id: 'nude_extortion',     type: '裸聊敲诈',     query: '最新 裸聊敲诈诈骗 警方通报 案例' },
]

// ─── 搜索引擎 ─────────────────────────────────────────────────────────────────

function readSerperKey() {
  try {
    if (fs.existsSync(paths.configFile)) {
      const cfg = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'))
      return cfg.serper_api_key || cfg.serperKey || null
    }
  } catch {}
  return process.env.SERPER_API_KEY || null
}

// 引擎1：Serper（Google SERP JSON，最稳定，需要 key）
async function searchViaSerper(query, limit = 5) {
  const key = readSerperKey()
  if (!key) return null
  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: limit, hl: 'zh-cn', gl: 'cn' }),
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null
    const data = await res.json()
    return (data.organic || []).slice(0, limit).map(r => ({
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
    })).filter(r => r.title && r.url)
  } catch { return null }
}

// 引擎2：DuckDuckGo HTML（无 key，中文诈骗查询质量最好）
function unwrapDdgUrl(url) {
  const decoded = String(url || '')
    .replace(/&amp;/g, '&')
  const uddg = decoded.match(/[?&]uddg=([^&]+)/)
  if (uddg) {
    try { return decodeURIComponent(uddg[1]) } catch { return uddg[1] }
  }
  if (decoded.startsWith('//')) return `https:${decoded}`
  return decoded
}

function parseDdgResults(html, limit = 5) {
  const results = []
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = re.exec(html)) !== null && results.length < limit) {
    const url = unwrapDdgUrl(match[1])
    const title = htmlToText(match[2])
    if (!url || !title) continue
    // 从结果块中提取 snippet
    const nextStart = re.lastIndex
    const nextMatch = html.slice(nextStart).match(/<a[^>]+class="result__a"/i)
    const block = nextMatch ? html.slice(nextStart, nextStart + nextMatch.index) : html.slice(nextStart, nextStart + 2000)
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i)
    const snippet = htmlToText(snippetMatch?.[1] || snippetMatch?.[2] || '')
    results.push({ title, url, snippet })
  }
  return results
}

async function searchViaDDG(query, limit = 5) {
  // 注意：duckduckgo.com/html/ 已失效，必须用 html.duckduckgo.com/html/
  const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
  const html = await fetchText(searchUrl, { headers: WEB_HEADERS }, 12000)
  if (!html) return null
  if (!html.includes('result__a')) return null
  const results = parseDdgResults(html, limit)
  if (results.length === 0) return null
  return results
}

// 引擎3：Bing HTML（最后兜底，中文诈骗查询质量差）
function parseBingResults(html, limit = 5) {
  const parts = html.split(/<li class="b_algo"/i).slice(1, limit + 1)
  const results = []
  for (const part of parts) {
    const headerMatch = part.match(/<h2[^>]*>\s*<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
    if (!headerMatch) continue
    const url = headerMatch[1]
    const title = htmlToText(headerMatch[2])
    if (!title || !url) continue
    const snippetMatch =
      part.match(/<p[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i) ||
      part.match(/class="[^"]*b_caption[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) ||
      part.match(/<p[^>]*>([\s\S]{30,}?)<\/p>/i)
    const snippet = snippetMatch ? htmlToText(snippetMatch[1]) : ''
    results.push({ title, url, snippet })
  }
  return results
}

async function searchViaBing(query, limit = 5) {
  const searchUrl = `https://cn.bing.com/search?q=${encodeURIComponent(query)}&setlang=zh-CN`
  const html = await fetchText(searchUrl, { headers: WEB_HEADERS }, 12000)
  if (!html) return null
  const results = parseBingResults(html, limit)
  if (results.length === 0) return null
  return results
}

// ─── 搜索结果质量过滤 ────────────────────────────────────────────────────────

// 诈骗相关关键词——标题/摘要至少包含一个才保留
const FRAUD_KEYWORDS = [
  '诈骗', '骗局', '骗', '诈', '警情', '通报', '警方', '公安', '反诈',
  '受害', '涉案', '转账', '赃', '预警', '提醒', '案例', '作案', '嫌疑人',
  '96110', '损失', '被骗', '套路', '手法', '新型',
]

// 无关域名黑名单——这些站点返回的结果直接丢弃
const DOMAIN_BLACKLIST = [
  'baike.baidu.com',     // 百度百科字典释义
  'hanyuguoxue.com',     // 汉语国学字典
  'ebay.com', 'ebay.cn', // eBay 商品
  'iqiyi.com',           // 爱奇艺视频
  'bilibili.com',       // B站视频
  'youku.com',           // 优酷视频
  'taobao.com', 'tmall.com', // 电商商品页
  'jd.com',              // 京东商品
]

function isFraudRelevant(result) {
  const text = (result.title + ' ' + result.snippet).toLowerCase()
  const url = result.url || ''

  // 1. 域名黑名单直接排除
  try {
    const host = new URL(url).hostname
    if (DOMAIN_BLACKLIST.some(d => host.includes(d))) return false
  } catch {}

  // 2. 标题或摘要必须包含至少一个诈骗关键词
  const hasKeyword = FRAUD_KEYWORDS.some(kw => text.includes(kw))
  if (!hasKeyword) return false

  return true
}

function filterSearchResults(results) {
  return results.filter(isFraudRelevant)
}

// 搜索引擎调度：DuckDuckGo（中文最佳，已修复）→ Serper（有 key）→ Bing（最后兜底）
async function searchFraud(query, limit = 5) {
  // 1. DuckDuckGo（中文诈骗查询质量最好）
  const ddgResult = await searchViaDDG(query, limit)
  if (ddgResult && ddgResult.length > 0) return { results: ddgResult, engine: 'duckduckgo' }

  // 2. Serper（如果配了 key）
  const serperResult = await searchViaSerper(query, limit)
  if (serperResult && serperResult.length > 0) return { results: serperResult, engine: 'serper' }

  // 3. Bing（最后兜底，中文质量差）
  const bingResult = await searchViaBing(query, limit)
  if (bingResult && bingResult.length > 0) return { results: bingResult, engine: 'bing' }

  return { results: [], engine: 'none' }
}

// 对单条搜索结果用 Jina Reader 提取正文摘要
async function fetchSummaryViaJina(url) {
  const jinaUrl = `https://r.jina.ai/${url}`
  const text = await fetchText(jinaUrl, {
    headers: { 'Accept': 'text/plain', 'X-Respond-With': 'no-references', 'User-Agent': WEB_HEADERS['User-Agent'] },
  }, 8000)
  if (!text || text.length < 50) return null
  // 取前 500 字作为摘要
  return text.replace(/\s+/g, ' ').trim().slice(0, 500)
}

// ─── 核心：采集 + 落盘 ────────────────────────────────────────────────────────

/**
 * 采集最新诈骗情报。
 * @param {Object} opts
 * @param {boolean} opts.force  强制刷新，忽略缓存
 * @param {string[]} opts.categoryIds  只采集指定类型（空=全部）
 * @returns {Promise<Object>} 情报对象
 */
export async function collectFraudIntel(opts = {}) {
  const { force = false, categoryIds = [] } = opts

  // 读缓存
  let stored = null
  if (fs.existsSync(INTEL_FILE)) {
    stored = safe(() => JSON.parse(fs.readFileSync(INTEL_FILE, 'utf8')))
  }
  const cacheAge = stored?.fetched_at
    ? Date.now() - new Date(stored.fetched_at).getTime()
    : Infinity

  if (!force && stored?.version === INTEL_VERSION && cacheAge < INTEL_CACHE_MS) {
    console.log('[fraud-intel] 缓存有效，跳过重新采集')
    _cached = stored
    return stored
  }

  const categories = categoryIds.length > 0
    ? FRAUD_CATEGORIES.filter(c => categoryIds.includes(c.id))
    : FRAUD_CATEGORIES

  console.log(`[fraud-intel] 开始采集 ${categories.length} 个诈骗类型的最新情报...`)

  const results = []
  const LIMIT_PER_CATEGORY = 5
  let usedEngine = 'none'

  for (const cat of categories) {
    console.log(`[fraud-intel] 采集: ${cat.type} (${cat.query})`)
    let searchResults = null
    try {
      const searchResult = await searchFraud(cat.query, LIMIT_PER_CATEGORY)
      searchResults = searchResult.results
      usedEngine = searchResult.engine
    } catch (err) {
      console.log(`[fraud-intel] ${cat.type} 搜索失败: ${err.message}`)
    }

    if (!searchResults || searchResults.length === 0) {
      results.push({ ...cat, cases: [] })
      continue
    }

    // 质量过滤：排除字典释义、电商商品、游戏攻略等无关结果
    const filtered = filterSearchResults(searchResults)
    if (filtered.length === 0) {
      console.log(`[fraud-intel] ${cat.type}: ${searchResults.length} 条结果全部被过滤（无关内容）`)
      results.push({ ...cat, cases: [] })
      continue
    }
    searchResults = filtered

    // 对前 3 条结果尝试提取正文摘要（控制并发和时间）
    const enriched = []
    for (const r of searchResults.slice(0, 3)) {
      let summary = r.snippet || ''
      if (!summary || summary.length < 30) {
        const jinaSummary = await fetchSummaryViaJina(r.url)
        if (jinaSummary) summary = jinaSummary
      }
      enriched.push({
        title: r.title,
        url: r.url,
        summary: summary || r.snippet || '',
        source: new URL(r.url).hostname,
      })
    }
    // 补上没提取正文的剩余条目（只带 snippet）
    for (const r of searchResults.slice(3)) {
      enriched.push({
        title: r.title,
        url: r.url,
        summary: r.snippet || '',
        source: safe(() => new URL(r.url).hostname) || '',
      })
    }

    results.push({ ...cat, cases: enriched })
  }

  const totalCases = results.reduce((sum, c) => sum + c.cases.length, 0)
  const result = {
    version: INTEL_VERSION,
    fetched_at: new Date().toISOString(),
    search_engine: usedEngine,
    categories: results,
    total_cases: totalCases,
  }

  safe(() => fs.writeFileSync(INTEL_FILE, JSON.stringify(result, null, 2), 'utf8'))
  _cached = result

  console.log(`[fraud-intel] 采集完成 — ${results.length} 个类型，共 ${totalCases} 条案例`)
  return result
}

// ─── 对外接口 ─────────────────────────────────────────────────────────────────

/**
 * 返回注入 system prompt 的纯文本块。
 * 必须在 collectFraudIntel() 完成后调用。
 */
export function getFraudIntelBlock() {
  if (!_cached?.categories?.length) return ''

  const lines = ['## Latest Fraud Intelligence (诈骗案例与套路情报)']

  for (const cat of _cached.categories) {
    if (!cat.cases?.length) continue
    lines.push('')
    lines.push(`### ${cat.type}`)
    cat.cases.forEach((item, i) => {
      lines.push(`${i + 1}. ${item.title}`)
      if (item.summary) lines.push(`   摘要: ${item.summary.slice(0, 200)}`)
      if (item.url)     lines.push(`   来源: ${item.source} (${item.url})`)
    })
  }

  lines.push('')
  lines.push('> 以上情报由定时采集器自动获取。发现与用户当前对话相关的新骗局手法时，应主动提醒用户。')

  return lines.join('\n')
}

/**
 * 返回原始缓存对象（同步）。
 */
export function getFraudIntelCache() {
  if (_cached) return _cached
  if (fs.existsSync(INTEL_FILE)) {
    _cached = safe(() => JSON.parse(fs.readFileSync(INTEL_FILE, 'utf8')))
  }
  return _cached
}

/**
 * 返回所有诈骗类型列表（供工具调用展示）。
 */
export function getFraudCategories() {
  return FRAUD_CATEGORIES.map(c => ({ id: c.id, type: c.type }))
}

// ─── 定时调度器：定时采集 + 主动推送 ────────────────────────────────────────

let _schedulerTimer = null
let _lastCaseData = null    // 上次采集的案例数据 { titles: Set, urls: Set }，用于检测新增

// 标题归一化：去除标点、空格、常见噪音词后做模糊对比
function normalizeTitle(title) {
  return String(title || '')
    .replace(/[\s\u3000\|\-\_—–·•【】\[\]()（）,，.。!！?？:：""]/g, '')
    .toLowerCase()
    .replace(/^(最新|警惕|注意|紧急|警方通报|反诈中心提醒)+/g, '')
    .trim()
}

// 从采集结果中提取所有案例的归一化标题和 URL，用于对比是否有新案例
function extractCaseTitles(result) {
  if (!result?.categories) return { titles: new Set(), urls: new Set() }
  const titles = new Set()
  const urls = new Set()
  for (const cat of result.categories) {
    for (const item of cat.cases || []) {
      if (item.title) titles.add(normalizeTitle(item.title))
      if (item.url) urls.add(item.url)
    }
  }
  return { titles, urls }
}

// 找出新案例（当前有但上次没有的）——标题归一化 + URL 双重去重
function findNewCases(lastData, result) {
  if (!lastData || (!lastData.titles && !lastData.urls)) return []
  const lastTitles = lastData.titles || new Set()
  const lastUrls = lastData.urls || new Set()
  if (lastTitles.size === 0 && lastUrls.size === 0) return []

  const newCases = []
  for (const cat of result.categories || []) {
    for (const item of cat.cases || []) {
      const normTitle = normalizeTitle(item.title)
      const url = item.url || ''
      // 标题和 URL 都没见过才算新案例
      const titleIsNew = normTitle && !lastTitles.has(normTitle)
      const urlIsNew = url && !lastUrls.has(url)
      if (titleIsNew && urlIsNew) {
        newCases.push({ ...item, category: cat.type })
      }
    }
  }
  return newCases
}

// 把新案例整理成推送文案（含来源链接）
function buildPushText(newCases) {
  if (newCases.length === 0) return ''
  const lines = ['【反诈情报更新】检测到 ' + newCases.length + ' 条新诈骗案例：\n']
  newCases.slice(0, 5).forEach((c, i) => {
    lines.push((i + 1) + '. [' + c.category + '] ' + c.title)
    if (c.summary) lines.push('   摘要: ' + c.summary.slice(0, 120))
    if (c.url) lines.push('   链接: ' + c.url)
    lines.push('')
  })
  if (newCases.length > 5) lines.push('...及其他 ' + (newCases.length - 5) + ' 条\n')
  lines.push('请留意以上新型诈骗手法，保护好个人信息和资金安全。如遇可疑情况请拨打 96110 咨询。')
  return lines.join('\n')
}

/**
 * 启动定时采集调度器。
 *
 * 配置来源：data/scheduled-reminder.json（由 /定时提醒 工具维护）
 * - enabled=false  → 只采集不推送（且不计入推送历史）
 * - enabled=true：
 *     · mode='interval'  → 每 interval_hours 小时采集一次，发现新案例推送
 *     · mode='daily'     → 每分钟检测一次，到达 daily_time 触发采集+推送
 *
 * @param {number} intervalHours  启动时的默认间隔（仅在配置不存在时使用）
 */
export function startFraudIntelScheduler(intervalHours = 6) {
  if (_schedulerTimer) {
    console.log('[fraud-intel] 调度器已在运行，跳过')
    return
  }

  // 读取配置（缺省时用启动参数）
  let cfg = safe(getReminderConfig, null) || {
    enabled: false, mode: 'interval', interval_hours: intervalHours, daily_time: '09:00',
  }
  if (!cfg.interval_hours) cfg.interval_hours = intervalHours
  console.log(`[fraud-intel] 启动定时调度器: ${cfg.enabled ? '已启用' : '未启用'} / ${cfg.mode}${cfg.mode === 'daily' ? ` @ ${cfg.daily_time}` : ` ${cfg.interval_hours}h`}`)

  // 立即做一次基线采集（不推送，只为建立 new-case 检测基线）
  collectFraudIntel().then(result => {
    if (result?.categories) {
      _lastCaseData = extractCaseTitles(result)
      console.log('[fraud-intel] 初始采集完成，记录 ' + _lastCaseData.titles.size + ' 条案例基线')
    }
  }).catch(() => {})

  // 定时器：每分钟唤醒一次，根据当前 config 决定是否真正触发采集+推送
  _schedulerTimer = setInterval(async () => {
    try {
      const liveCfg = safe(getReminderConfig, null)
      if (!liveCfg) return

      // 未启用 → 跳过（但仍保留定时器，每分钟检测重新启用）
      if (!liveCfg.enabled) return

      const now = new Date()
      const trigger = shouldTriggerNow(liveCfg, _lastDailyTrigger, now)
      if (!trigger) return
      _lastDailyTrigger = now.toISOString()

      console.log('[fraud-intel] 定时采集触发（模式=' + liveCfg.mode + '）...')
      const result = await collectFraudIntel({ force: true })
      const newData = extractCaseTitles(result)
      const newCases = findNewCases(_lastCaseData, result)

      let pushedToWechat = 0
      if (newCases.length > 0) {
        // 1. SSE 事件推给前端
        emitEvent('fraud_intel_update', {
          new_count: newCases.length,
          total_cases: result.total_cases,
          fetched_at: result.fetched_at,
          cases: newCases.slice(0, 5).map(c => ({
            type: c.category,
            title: c.title,
            source: c.source,
            url: c.url || '',
            summary: (c.summary || '').slice(0, 200),
          })),
        })
        // 2. pushMessage 让 Agent 在下个 TICK 看到
        const pushText = buildPushText(newCases)
        pushMessage('SYSTEM', pushText, 'FRAUD_INTEL', {})
        // 3. 微信推送
        const tokens = getAllClawbotTokens()
        for (const { from_user_id } of tokens) {
          dispatchSocialMessage(`wechat:clawbot:${from_user_id}`, { text: pushText })
            .then(r => {
              if (r?.ok) pushedToWechat++
            })
            .catch(err => console.warn('[fraud-intel] 微信推送失败 ' + from_user_id + ':', err.message))
        }
        console.log('[fraud-intel] 检测到 ' + newCases.length + ' 条新案例，已推送（微信用户 ' + tokens.length + ' 个）')
      } else {
        console.log('[fraud-intel] 定时采集完成，无新案例')
      }

      _lastCaseData = newData

      // 写入推送历史（不管是否有新案例，都记录一次触发）
      safe(() => recordReminderRun({
        type: liveCfg.mode,
        new_count: newCases.length,
        users: getAllClawbotTokens().length,
        status: newCases.length > 0 ? 'pushed' : 'no_change',
      }), null)
    } catch (err) {
      console.log('[fraud-intel] 定时采集失败: ' + (err?.message || err))
    }
  }, 60 * 1000)  // 每分钟唤醒一次

  if (_schedulerTimer.unref) _schedulerTimer.unref()
  console.log('[fraud-intel] 定时调度器已启动（每分钟检测，模式由配置决定）')
}

// ─── 触发判定 ───────────────────────────────────────────────────────────────

let _lastDailyTrigger = null  // ISO 字符串，daily 模式下已触发的最后时间

/**
 * 判定当前时间是否该触发一次采集+推送。
 * - interval 模式：距上次触发超过 interval_hours 小时
 * - daily 模式：当前 HH:MM 等于 daily_time 且今天还没触发过
 *
 * @param {object} cfg   当前配置
 * @param {string|null} lastTriggerISO  上次触发的 ISO 时间
 * @param {Date} now     当前时间
 * @returns {boolean}
 */
function shouldTriggerNow(cfg, lastTriggerISO, now) {
  if (cfg.mode === 'daily') {
    const target = String(cfg.daily_time || '09:00')
    const cur = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    if (cur !== target) return false
    if (!lastTriggerISO) return true
    // 同一分钟内最多触发一次（同分钟多次滚动不算）
    const last = new Date(lastTriggerISO)
    if (sameDay(last, now) && last.getHours() === now.getHours() && last.getMinutes() === now.getMinutes()) return false
    return true
  }
  // interval 模式
  const ms = (Number(cfg.interval_hours) || 6) * 60 * 60 * 1000
  if (!lastTriggerISO) return true
  return (now.getTime() - new Date(lastTriggerISO).getTime()) >= ms
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * 停止定时调度器。
 */
export function stopFraudIntelScheduler() {
  if (_schedulerTimer) {
    clearInterval(_schedulerTimer)
    _schedulerTimer = null
    console.log('[fraud-intel] 定时调度器已停止')
  }
}
