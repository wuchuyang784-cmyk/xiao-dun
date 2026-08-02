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
  { id: 'brushing',           type: '刷单返利',     query: '刷单返利诈骗 警方通报 案例' },
  { id: 'refund_customer',    type: '冒充客服退款',  query: '冒充客服退款诈骗 警方通报 案例' },
  { id: 'impersonate_police', type: '冒充公检法',   query: '冒充公检法诈骗 警方通报 案例' },
  { id: 'fake_investment',    type: '虚假投资理财',  query: '投资理财诈骗 警方通报 案例' },
  { id: 'pig_butchering',     type: '杀猪盘',       query: '杀猪盘诈骗 警方通报 案例' },
  { id: 'loan_scam',          type: '贷款诈骗',     query: '网贷贷款诈骗 警方通报 案例' },
  { id: 'prize_scam',         type: '中奖诈骗',     query: '中奖诈骗 警方通报 案例' },
  { id: 'nude_extortion',     type: '裸聊敲诈',     query: '裸聊敲诈诈骗 警方通报 案例' },
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
  const searchUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`
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

// 搜索引擎调度：Serper（有 key）→ DuckDuckGo（中文最佳）→ Bing（最后兜底）
async function searchFraud(query, limit = 5) {
  // 1. Serper（如果配了 key）
  const serperResult = await searchViaSerper(query, limit)
  if (serperResult && serperResult.length > 0) return { results: serperResult, engine: 'serper' }

  // 2. DuckDuckGo（中文诈骗查询质量最好）
  const ddgResult = await searchViaDDG(query, limit)
  if (ddgResult && ddgResult.length > 0) return { results: ddgResult, engine: 'duckduckgo' }

  // 3. Bing（最后兜底）
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
  const LIMIT_PER_CATEGORY = 3
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

    // 对前 2 条结果尝试提取正文摘要（控制并发和时间）
    const enriched = []
    for (const r of searchResults.slice(0, 2)) {
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
    for (const r of searchResults.slice(2)) {
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
