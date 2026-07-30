// =============================================================================
// capability-registry.js —— 能力机制（Capability Mechanism）唯一真相源
//
// 背景 / 第一性原理：
//   小盾里「一个领域的能力」原本被切成 3~4 片，散在不同文件、靠重复的关键词表
//   手动同步：工具半在 tool-router.js（XXX_TRIGGERS + XXX_TOOLS），工作流半在
//   prompt.js（XXX_BLOCK + shouldInjectXxx），数据预喂半在 runtime-injector.js
//   （buildXxxRuntimeContext）。每改一个领域要同时动两三个文件、对齐两份关键词。
//
//   能力 = 一段工作流上下文（prompt 块）+ 配套工具 + 运行时数据预喂，由情境触发、
//   打包一起注入，且小盾能自我感知、按需主动激活。本模块把上述三半收敛成一个
//   声明式单元，让每个能力的关键词、工具、工作流、数据只剩一处。
//
// 关键设计：保留「分面解耦」。现有架构故意让 tools / context / prefeed 各有自己的
//   激活条件（例：热点、世界杯工具都不自动注入，但两者的 prompt 块随关键词注入）。
//   强行用单一 detect 会把「关键词自动加载工具」加回来——正是先前特意删掉的。
//   所以每个能力分别声明：
//     - detect(ctx)   领域相关信号 → 控 context 注入 +（默认）tool 注入门
//     - toolWhen(ctx) tool 自动注入条件（可覆盖 detect；不写则用 detect）
//     - prefeed(ctx)  运行时数据预喂（自门控，复用现成 build 函数）
//     - triggers      关键词集 → find_tool 发现 + 自感知按需激活
//
// 本模块是工具名数组（WEB_TOOLS 等已迁能力的）的归属地，tool-router.js 反向 import，
// 保持单向依赖、无循环。未迁能力（filesystem/exec/media/...）的工具名仍在 tool-router。
// =============================================================================

import { buildHotspotRuntimeContext } from '../hotspots.js'
import { buildWeatherRuntimeContext } from '../weather.js'
import { listApiSlotCapabilities } from './api-slots.js'

// ---- 已迁能力的工具名数组（本模块为唯一定义处；tool-router 从这里 import）----
export const WEB_TOOLS = ['web_search', 'fetch_url', 'browser_read']
export const HOTSPOT_TOOLS = ['hotspot_mode']
export const CASES_IMPORT_TOOLS = ['cases_import_mode']
export const RECORD_TOOLS = ['record_panel_mode']

// ---- 触发词 / 触发正则 ----
// 工具半历史上用字面包含的字符串数组（tool-router），工作流半用正则（prompt）。两者各自
// 与既有行为对齐，能力对象同时持有，detect 用正则、find_tool 发现用 triggers 数组。
const WEB_TRIGGERS = [
  '搜', '搜索', '查一下', '查查', '百度', '谷歌', '上网', '在线', '网页',
  '网址', '链接', '浏览', '打开网页', '看看网上', '抓一下',
  'search', 'google', 'bing', 'fetch', 'http://', 'https://', 'url',
  'web', 'browser', 'browse', 'website', '.com', '.cn', '.org', '.io',
]
const HOTSPOT_TRIGGERS = [
  '热点', '热搜', '热门', '新闻', '今日', '趋势', '榜单', '头条', 'trending',
  'news', 'hot ', 'top ', '微博热搜', '热议',
]
const CASES_IMPORT_TRIGGERS = [
  '案例导入', '批量导入', '导入案例', '诈骗案例', '知识库', '诈骗知识库', '向量库', 'rag',
  '建库', '案例库', '导入诈骗', '案例入库', 'case import', 'knowledge base',
]
const RECORD_TRIGGERS = [
  '记录备案', '备案', '分析记录', '审计记录', '使用备案', '记录面板', '备案面板',
  'record panel', 'audit log', 'audit record',
]

const WEATHER_KEYWORD_RE = /天气|温度|气温|下雨|降雨|下雪|雾霾|阴天|晴天|多云|wttr|weather/i
const HOTSPOT_KEYWORD_RE = /热点|热搜|热门|新闻|今日|趋势|榜单|头条|热议|微博热搜|trending|headline/i
const CASES_IMPORT_KEYWORD_RE = /案例导入|批量导入|导入案例|诈骗案例|知识库|诈骗知识库|向量库|rag\b|建库|案例库|导入诈骗|案例入库/i
const RECORD_KEYWORD_RE = /记录备案|备案|分析记录|审计记录|使用备案|记录面板|备案面板/i

// ---- 工作流块（prompt 注入用；从 prompt.js / index.js 搬来，文本逐字保留）----
const WEATHER_CONTEXT_BLOCK = `### Weather Surface Rules
- The data source must be wttr.in only. Do not use search engines or other weather sites. Use this fixed call:
  fetch_url("https://wttr.in/{city-English-name}?format=j1&lang=zh")
- Map the following fields the weather kind actually renders. Only fill a field that is actually present in the JSON; leave a missing field empty rather than supplying a typical value or a guess:
  - city       <- nearest_area[0].areaName[0].value, any language is fine; if missing, use the city the user asked about.
  - temp       <- current_condition[0].temp_C, number
  - condition  <- current_condition[0].lang_zh[0].value or weatherDesc[0].value
  - variant    <- "compact" for a 3-day card, or "week" when the user asks for one week / seven days.
  - forecast   <- compact: three items from weather[0..2]; week: seven items if available. Each item is { day, low, high, condition }.
- Call: ui_set({ id: "weather-<city>", kind: "weather", data: { variant, city, temp, condition, forecast }, intent: "ambient" })
- If a matching weather surface is already listed in Supplemental Context, do not call ui_set again unless the user asks to refresh or the surface data is clearly missing.
- To refresh, call ui_set again with the same id.`

const HOTSPOT_CONTEXT_BLOCK = `### Hotspot Panel
- You have a hotspot_mode tool that opens a visual hotspot / trending-topics panel. It is NOT pre-loaded each turn — if it is not in your current tool list, call find_tool("热点 面板 hotspot") first to load it, then call it.
- Open it (action="show") only when the user actually wants to browse trending topics, or a demo/scene needs it; close it (action="hide") when asked. Do not open it for ordinary Q&A.
- While the panel is open, current hotspot data is injected into your context automatically — answer from that rather than guessing.`

const CASES_IMPORT_CONTEXT_BLOCK = `### Case Import / Knowledge Base Panel
- You have a cases_import_mode tool that opens the Case Import / Knowledge Base panel (案例导入 / 知识库). It is NOT pre-loaded each turn — if it is not in your current tool list, call find_tool("案例导入 知识库 case import") first to load it, then call it.
- Open it (action="show") when the user wants to batch-import fraud / scam cases, manage the case knowledge base, or build the RAG vector index; close it (action="hide") when asked.
- The panel lets the admin paste a batch of Chinese scam-case reports, parse them into structured records, and ingest them into the case library (with vector indexing for later semantic search). While the panel is open, you can describe what to import or summarize import results from the panel.`

const RECORD_CONTEXT_BLOCK = `### Record / Filing Panel (记录备案)
- You have a record_panel_mode tool that opens the Record / Filing panel (记录备案). It is NOT pre-loaded each turn — if it is not in your current tool list, call find_tool("记录备案 备案 record panel") first to load it, then call it.
- Open it (action="show") when the user asks to view the App's AI-analyzed usage filings / audit records / analysis history; close it (action="hide") when asked.
- The panel lists every analysis the App AI performed (who/what/when/why), serving as the compliance audit trail. While it is open, you can answer questions about specific records, summarize trends, or explain a filing entry the user points at. Do NOT invent record contents — read them from the panel.`

// 安装工作流：原先以 directions.unshift 注入在 index.js，现归位为能力 context，统一经
// buildSystemPrompt 注入（同一份文本、同一道 isSoftwareInstallRequest 门）。
// 通用辅助：text 已小写，triggers 字面包含。
function hits(text, triggers) {
  if (!text) return false
  for (const t of triggers) {
    if (text.includes(t)) return true
  }
  return false
}

// =============================================================================
// 能力定义（v1：已配对的 web / weather / hotspot / worldcup / web/weather）
//
// 每个能力字段：
//   id / label / summary —— 标识 + 自感知/发现用的人读描述
//   triggers             —— 关键词数组（find_tool 发现 + 按需激活）
//   tools                —— 配套工具名
//   detect(ctx)          —— 领域相关？控 context 注入 + prefeed +（默认）tool 注入门
//   toolWhen(ctx)        —— 可选：tool 自动注入条件，覆盖 detect
//   context              —— 可选：工作流块（detect 命中且存在时注入 prompt）
//   prefeed(ctx)         —— 可选：运行时数据预喂（自门控，返回字符串/Promise<字符串>）
// ctx 形状：{ text(小写正文), rawText(原文), isTick, mmCaps, hasTask, hasActiveFocus }
// =============================================================================
export const CAPABILITIES = [
  {
    id: 'web',
    label: '上网',
    summary: '联网搜索、抓取网页正文、读取链接内容（web_search / fetch_url / browser_read）。',
    triggers: WEB_TRIGGERS,
    tools: WEB_TOOLS,
    // 上网无独立工作流块。Tick 先由主模型判断，再经 find_tool 按需加载，
    // 不因为心跳本身预装联网能力。
    detect: (ctx) => hits(ctx.text, WEB_TRIGGERS),
    toolWhen: (ctx) => hits(ctx.text, WEB_TRIGGERS),
    context: null,
    prefeed: null,
  },
  {
    id: 'weather',
    label: '天气',
    summary: '查实时天气（仅 wttr.in 取数）并以 weather 卡片投影；含地理实况预喂。',
    triggers: ['天气', '温度', '气温', '下雨', '下雪', 'weather', 'wttr'],
    // 天气需要 fetch_url 抓 wttr.in，因此命中即带上 web 工具（修复旧路径偶尔无 fetch 可用的缺口）。
    tools: WEB_TOOLS,
    detect: (ctx) => WEATHER_KEYWORD_RE.test(ctx.rawText || ''),
    context: WEATHER_CONTEXT_BLOCK,
    prefeed: (ctx) => buildWeatherRuntimeContext(ctx.rawText || ''),
  },
  {
    id: 'hotspot',
    label: '热点面板',
    summary: '打开热搜/趋势可视化面板（hotspot_mode）；面板开启时实时热点数据自动预喂。',
    triggers: HOTSPOT_TRIGGERS,
    tools: HOTSPOT_TOOLS,
    // 面板不再走关键词自动开：detect 恒 false，关键词只保留给 find_tool 发现用。
    // 面板仅由 /command 显式指令或 intent-resolver 意图识别（forcedCapabilityIds）注入，
    // 杜绝「关键词命中 + 意图识别」双触发导致的重复开面板。
    detect: () => false,
    // 面板工具不自动注入；无论用户轮还是 Tick，Agent 判断需要后经 find_tool 装载。
    toolWhen: () => false,
    context: HOTSPOT_CONTEXT_BLOCK,
    prefeed: (ctx) => buildHotspotRuntimeContext(ctx.rawText || ''),
  },
  {
    id: 'cases-import',
    label: '案例导入面板',
    summary: '打开案例导入 / 知识库面板（cases_import_mode）；批量导入诈骗案例并建库（含 RAG 向量索引）。',
    triggers: CASES_IMPORT_TRIGGERS,
    tools: CASES_IMPORT_TOOLS,
    // 面板不再走关键词自动开：detect 恒 false（理由同 hotspot，见上）。
    detect: () => false,
    // 面板工具不自动注入；Agent 判断需要后经 find_tool 装载（与 hotspot/worldcup 一致）。
    toolWhen: () => false,
    context: CASES_IMPORT_CONTEXT_BLOCK,
    prefeed: null,
  },
  {
    id: 'record',
    label: '记录备案面板',
    summary: '打开记录备案 / 审计面板（record_panel_mode）；查看 App AI 分析的使用备案与审计记录。',
    triggers: RECORD_TRIGGERS,
    tools: RECORD_TOOLS,
    // 面板不再走关键词自动开：detect 恒 false（理由同 hotspot，见上）。
    detect: () => false,
    toolWhen: () => false,
    context: RECORD_CONTEXT_BLOCK,
    prefeed: null,
  },

]

const CAPABILITY_BY_ID = new Map(CAPABILITIES.map(c => [c.id, c]))

// ---- 消费端 helpers ----

function allCapabilities() {
  return [...CAPABILITIES, ...listApiSlotCapabilities()]
}

// 强制激活的能力（由 intent-resolver 在每轮装配前算出并透传 via ctx.forcedCapabilityIds）。
// 用于「显式指令」与「LLM 意图兜底」选中的能力：无论其 detect / toolWhen 是否放行，
// 都强制注入工具 + 工作流块，让 LLM 能直接选它（面板工具默认 toolWhen=false 不自动注入，
// 关键词 miss 时 LLM 根本拿不到，这正是要补的缺口）。
function forcedCapabilities(ctx = {}) {
  const ids = ctx && ctx.forcedCapabilityIds
  if (!Array.isArray(ids) || ids.length === 0) return []
  const out = []
  for (const id of ids) {
    const c = getCapability(id)
    if (c) out.push(c)
  }
  return out
}

// 领域相关的能力（detect 命中）——用于 context 注入与自感知「现在哪些能力在场」。
// 叠加强制激活的能力（去重），使 intent-resolver 选中的能力无论 detect 是否命中都会进场。
export function selectActiveCapabilities(ctx = {}) {
  const base = allCapabilities().filter(c => safeCall(c.detect, ctx))
  const forced = forcedCapabilities(ctx).filter(c => !base.includes(c))
  return [...base, ...forced]
}

// 本轮要自动注入的工具名（去重）。每能力用 toolWhen（缺省回落 detect）单独判断，
// 保留 tools / context 解耦。最后叠加强制激活能力的工具（intent-resolver 选中项），
// 保证关键词 miss 时面板工具也能进工具表、LLM 可自主调用。
export function capabilityToolsFor(ctx = {}) {
  const out = new Set()
  for (const c of allCapabilities()) {
    const gate = c.toolWhen || c.detect
    if (safeCall(gate, ctx)) {
      for (const name of (c.tools || [])) out.add(name)
    }
  }
  for (const c of forcedCapabilities(ctx)) {
    for (const name of (c.tools || [])) out.add(name)
  }
  return [...out]
}

// 本轮要注入的工作流块（detect 命中且能力有 context）。
export function capabilityContextBlocks(ctx = {}) {
  const blocks = []
  for (const c of selectActiveCapabilities(ctx)) {
    if (c.context) blocks.push(c.context)
  }
  return blocks
}

// 运行时数据预喂：跑所有能力的 prefeed（自门控，非相关返回空），并发 await。
// 返回 { text: 拼好的非空预喂文本, byId: { [capId]: 该能力预喂文本 } }。
export async function runCapabilityPrefeed(ctx = {}) {
  const withPrefeed = allCapabilities().filter(c => typeof c.prefeed === 'function')
  const results = await Promise.all(withPrefeed.map(async (c) => {
    try {
      const text = await c.prefeed(ctx)
      return [c.id, typeof text === 'string' ? text : '']
    } catch {
      return [c.id, '']
    }
  }))
  const byId = {}
  for (const [id, text] of results) byId[id] = text
  const text = results.map(([, t]) => t).filter(Boolean).join('\n\n')
  return { text, byId }
}

// 自感知 / find_tool 用的能力清单。
export function listCapabilities() {
  return allCapabilities().map(c => ({
    id: c.id,
    label: c.label,
    summary: c.summary,
    tools: [...(c.tools || [])],
    triggers: [...(c.triggers || [])],
    hasContext: !!c.context,
  }))
}

// find_tool 发现：query 命中能力的 triggers / label / summary → 返回该能力（含工具与工作流摘要）。
// 实现「自感知按需激活」的发现半：关键词没在 prompt 注入时，Agent 调 find_tool 也能找到能力、
// 拿到工具并知道怎么用。
export function findCapabilitiesByQuery(query = '') {
  const q = String(query || '').toLowerCase().trim()
  if (!q) return []
  const terms = q.split(/[\s,，、。.；;]+/).map(t => t.trim()).filter(Boolean)
  const matched = []
  for (const c of allCapabilities()) {
    const hitTrigger = (c.triggers || []).some(t => q.includes(String(t).toLowerCase()))
    const hay = `${c.id} ${c.label} ${c.summary}`.toLowerCase()
    const hitText = terms.some(t => t.length >= 2 && hay.includes(t))
    if (hitTrigger || hitText) {
      matched.push({ id: c.id, label: c.label, summary: c.summary, tools: [...(c.tools || [])], context: c.context || '' })
    }
  }
  return matched
}

export function getCapability(id) {
  return CAPABILITY_BY_ID.get(id) || allCapabilities().find(c => c.id === id) || null
}

function safeCall(fn, ctx) {
  if (typeof fn !== 'function') return false
  try { return !!fn(ctx) } catch { return false }
}
