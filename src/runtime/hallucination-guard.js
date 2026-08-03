// 小盾反幻觉守卫模块
// 每轮 LLM 回复后执行检测，生成下一轮 context 注入

// --- 伪造提醒检测 ---
// 匹配中文时间表达 + 提醒语义，但本轮未调用 manage_reminder
const FAKE_REMINDER_RE = /(\d{1,2}:\d{2})[\s\S]{0,10}?(?:提醒|记得|注意|我会|通知)/gi

/**
 * 检测 LLM 回复中是否有"假装提醒"的模式
 * @param {string} text - LLM 回复文本
 * @param {Set<string>} calledTools - 本轮实际调用的工具名
 * @returns {string|null} 注入提示，或 null
 */
export function detectFakeRemind(text, calledTools) {
  if (!text || calledTools.has('manage_reminder')) return null
  const matches = [...text.matchAll(FAKE_REMINDER_RE)]
  if (matches.length === 0) return null
  const times = matches.map(m => m[1]).filter(Boolean).join(', ')
  return `⛔ 上轮你说了"${times}提醒"，但你没有调用 manage_reminder——用户不会收到这个提醒！这一轮要么补调工具，要么明确告诉用户你无法设置提醒。不要只是口头承诺。`
}

// --- 重复输出检测 ---
const REPEAT_HISTORY_SIZE = 4
let _recentReplies = []

/**
 * 检测连续回复是否高度相似
 * @param {string} text - 当前回复
 * @returns {string|null}
 */
export function detectRepeat(text) {
  if (!text) return null
  _recentReplies.push(text.slice(0, 200))
  if (_recentReplies.length > REPEAT_HISTORY_SIZE) _recentReplies.shift()
  if (_recentReplies.length < 3) return null

  // 简版 Jaccard：共用 2-gram 占比
  const jaccard = (a, b) => {
    const bigrams = s => { const set = new Set(); for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2)); return set }
    const sa = bigrams(a), sb = bigrams(b)
    let intersect = 0; for (const x of sa) if (sb.has(x)) intersect++
    return intersect / Math.max(1, sa.size + sb.size - intersect)
  }

  const recent = _recentReplies
  let similar = 0
  for (let i = 0; i < recent.length - 1; i++) {
    if (jaccard(recent[i], recent[i + 1]) > 0.7) similar++
  }
  if (similar >= recent.length - 1) {
    _recentReplies = [] // 重置，避免连续触发
    return '🔁 检测到你连续输出了高度相似的回复。下一轮必须说新东西。如果当前状况没有新信息，保持简短的自然回应（如"嗯，我在"），不要重复反诈说教模板。'
  }
  return null
}

// --- 反诈模板关键词检测（输出后筛查） ---
const FRAUD_KEYWORDS = ['刷单返利', '冒充客服', '公检法', '投资理财', '杀猪盘', '贷款诈骗', '裸聊敲诈', '网络约炮', '虚假贷款']

let _boilerplateCount = 0
const BOILERPLATE_MAX = 3

export function detectBoilerplate(text) {
  if (!text) return null
  const hits = FRAUD_KEYWORDS.filter(k => text.includes(k)).length
  if (hits >= 3) {
    _boilerplateCount++
    if (_boilerplateCount >= BOILERPLATE_MAX) {
      _boilerplateCount = 0
      return '⚠️ 连续多轮大量列出诈骗类型关键词，疑似陷入说教模板循环。下一轮用自然对话方式回应，像一个朋友而不是反诈宣传员。'
    }
  } else {
    _boilerplateCount = 0
  }
  return null
}

/**
 * 综合检测：返回需要注入 context 的提示数组
 * @param {string} replyText - 本 LLM 回复文本
 * @param {Set<string>} calledTools - 本轮调用的工具名
 * @returns {string[]}
 */
export function collectGuards(replyText, calledTools = new Set()) {
  const guards = []
  const a = detectFakeRemind(replyText, calledTools)
  const b = detectRepeat(replyText)
  const c = detectBoilerplate(replyText)
  if (a) guards.push(a)
  if (b) guards.push(b)
  if (c) guards.push(c)
  return guards
}

// --- 跨轮状态管理 ---
let _pendingGuards = []

/**
 * 下一轮 context 注入队列
 */
export function enqueueGuardInjection(injection) {
  if (injection) _pendingGuards.push(injection)
}

/**
 * 取出并清空待注入项（由 context builder 调用）
 */
export function drainGuardInjections() {
  const guards = _pendingGuards.slice()
  _pendingGuards = []
  return guards
}

/**
 * 清空内部状态（切换对话、/clear 时调用）
 */
export function resetGuardState() {
  _recentReplies = []
  _boilerplateCount = 0
  _pendingGuards = []
}
