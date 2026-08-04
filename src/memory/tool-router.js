// 按需注入工具选择器（动态上下文记忆池第 4 步）。
//
// 之前 injector.js 把约 35-40 个工具 schema 全量塞进每轮 LLM 调用的 tools
// 字段，单这一项就占 6-9K token。这里按"领域 + 意图"分组，只注入这轮真正
// 用得上的组——其它组省掉。
//
// 规则要点：
//   1) 按"动作意图"匹配（动词为主），不复用 keywords.js 的话题抽取
//   2) ActionLog 保活：最近 10 次工具调用强制注入，保证跨轮连贯
//   3) TICK 心跳保持精简：给自主判断、记忆和节奏控制；其它能力由 find_tool 按判断加载
//   4) Fallback 安全网：最终工具数 < 8 时补 web + filesystem（最常用兜底）
//   5) 用户轮保留已安装工具；Tick 通过 find_tool 按判断发现，避免安装等同于永久自治授权
//   6) 多模态生成工具：mmCaps 已配置 AND 关键词命中才注入，避免太激进
//
// 输入 ctx：
//   - messageBody          已剥离 envelope 的消息正文
//   - isTick               是否 TICK 心跳
//   - senderId             消息发送方 ID（用来判断要不要 search_memory）
//   - hasTask              是否有 active task
//   - hasRecall            state.prev_recall 是否非空
//   - mmCaps               多模态能力数组（registry.listCapabilities()）
//   - recentActionLog      最近 N 条 action_log（保活源）
//   - installedToolNames   marketplace 已安装的扩展工具
//   - startupSelfCheckActive  启动自检激活标志
//   - localVisualTurn      是否能安全展示本机 UI（TUI/voice 是 true，微信等外部渠道是 false）
//   - fastUserPath         可选——是否实时用户消息（用于"再激进省一点"，未传按 false）
//
// 输出：去重后的 tools: string[]

// 已迁能力的工具名 + 工具注入选择器由能力注册表提供（单向依赖：registry 不 import 本文件）。
import { WEB_TOOLS, capabilityToolsFor } from '../capabilities/capability-registry.js'
import { shouldInjectCapabilityDemo } from '../capability-demo-intent.js'

// ---- 工具分组 ----
//
// core：任何场景都注入。
const CORE_TOOLS = [
  'send_message',
  'recall_memory',
  // find_tool：工具发现入口。每轮只注入约 35 个工具里命中意图的子集，模型若需要一个本轮没注入的
  // 工具（比如关键词没命中导致 generate_image / exec_command 没进来），可调 find_tool 搜出来并当场装载。
  'find_tool',
  'ui_set',
  // voice_retire：收起悬浮语音球。常驻很轻（一个小 schema），但保证语音对话轮一定可用；
  // 何时调由 prompt 的 Voice Orb 段（仅语音轮注入）指导，非语音轮虽在工具表但不会被提示使用。
  'voice_retire',
]

const TASK_CTRL_FULL    = ['set_task', 'complete_task', 'update_task_step']
const TASK_CTRL_OPENER  = ['set_task']  // 没任务时只暴露 set_task

// WEB_TOOLS 由能力注册表提供（见顶部 import），并被 media / fallback 复用。
const FILESYSTEM_TOOLS  = ['read_file', 'write_file', 'delete_file', 'list_dir', 'make_dir']
const EXEC_TOOLS        = ['exec_command', 'exec_quick_command', 'exec_task_command', 'exec_background_command', 'download_file', 'kill_process', 'list_processes']
const MEDIA_TOOLS       = ['media_mode']
const REMINDER_TOOLS    = ['manage_reminder']
const PREFETCH_TOOLS    = ['manage_prefetch_task']
const TICKER_TOOLS      = ['set_tick_interval']
// Startup self-check is a deterministic, local-only three-step flow. Keep its
// schemas available in its first turn so the fixed validation cannot be skipped
// or abandoned while waiting for on-demand discovery.
const STARTUP_SELF_CHECK_TOOLS = [
  'complete_startup_self_check',
  ...FILESYSTEM_TOOLS,
  ...WEB_TOOLS,
  ...MEDIA_TOOLS,
  'hotspot_mode',
]
const TERMINAL_STREAM_TOOLS = ['terminal_stream']
const CAPABILITY_DEMO_TOOLS = ['capability_demo']
const ADMIN_TOOLS       = [
  'manage_tool_factory', 'install_tool', 'uninstall_tool', 'list_tools',
  'set_security', 'connect_wechat', 'connect_feishu',
  'set_location', 'set_agent_name', 'manage_rule',
  'manage_api_capability',
  'fraud_rule_screen',
  'fraud_intel',
  'check_link',
  'check_sms',
]
const INLINE_IMAGE_RE = /!\[[^\]]*]\(|\/media\/chat\/|data:image\//i
const API_KEY_RE = /\b(?:sk|ak|rk|pk|ark)-[A-Za-z0-9_\-.]{12,180}\b/i
const API_DOCS_RE = /https?:\/\/|api|docs?|platform|capability|endpoint|base[-_\s]?url|model|auth|\u6587\u6863|\u63a5\u53e3|\u914d\u7f6e|\u80fd\u529b/i
const API_CONFIG_CONFIRM_RE = /^(?:yes|yep|ok|okay|sure|do it|go ahead|\u662f|\u662f\u7684|\u53ef\u4ee5|\u597d|\u597d\u7684|\u5bf9|\u884c|\u914d\u7f6e|\u914d\u4e0a|\u8bbe\u7f6e|\u8bbe\u6210)$/i

// ---- 关键词触发集 ----
//
// 设计原则：动词 + 强名词，宁可漏命中也不要误命中导致全 schema 都灌进去。
// 中文用纯字面包含；英文需考虑单词边界，但 messageBody.includes 已经够鲁棒
// （"file" 不会误中 "filename" 也无所谓，命中只是多注入而不是漏）。
// 全部 lower-cased。

const FILESYSTEM_TRIGGERS = [
  '文件', '路径', '目录', '文件夹', '读取', '读一下', '读下', '看下文件',
  '写入', '保存', '另存', '存到', '新建', '建一个', '建个文件',
  '删除', '删掉', '清理', '文档', 'readme', '日志', '配置文件',
  'file', 'folder', 'directory', 'path', 'read ', 'write ', 'save ',
  'create file', 'delete file', 'mkdir', 'ls ', 'dir ', '.txt', '.md',
  '.json', '.js', '.py', '.html', '.csv',
]

const EXEC_TRIGGERS = [
  '运行', '执行', '跑一下', '跑个', '命令', '终端', '控制台', '进程', '杀掉',
  '启动', '停止', '关掉程序', 'shell',
  'run ', 'execute', 'cmd', 'command', 'process', 'kill', 'pid', 'powershell',
  'bash', 'terminal', 'console',
]

const MEDIA_TRIGGERS = [
  '??', '???', '??', 'b?', 'bilibili', '??', '???',
  'video', 'movie', 'mv ',
]

const REMINDER_TRIGGERS = [
  '提醒', '记一下', '别忘', '到时候', '明天', '后天', '今晚', '明早',
  '几点', '点钟', '点叫', '点喊', '计划', '安排', '日程',
  'remind', 'reminder', 'schedule', 'alarm', 'wake me', 'notify',
]

const PREFETCH_TRIGGERS = [
  '预热', '预取', '订阅', '定期', '每天', '每小时', '推送', '关注', 'feed',
  'subscribe', 'rss', 'periodic', 'prefetch', 'cron',
]

const TICKER_TRIGGERS = [
  '心跳', '节奏', '间隔', '频率', '多久叫一次', '别老叫', 'tick', 'cadence',
  'heartbeat', 'interval',
]

const TERMINAL_STREAM_TRIGGERS = [
  '行动可视化', '文本流', '命令行窗口', '终端窗口', '黑底白字', '写文件过程', '写入过程',
  'terminal stream', 'terminal window', 'command line window', 'progress stream',
  'visible progress', 'show progress', 'work log window',
]

const CAPABILITY_DEMO_TRIGGERS = [
  '你能做什么', '你会做什么', '你可以做什么', '你有什么能力', '你有哪些能力',
  '能力展示', '功能展示', '能力演示', '功能演示',
  'what can you do', 'capability demo', 'show capability',
]

const ADMIN_TRIGGERS = [
  '装一下', '安装', '装个', '卸载', '装好', '装上', '工具市场', '插件',
  '自写工具', '自己写工具', '工具工厂', '工具审核', '生成工具', '注册工具',
  '安全', '沙箱', '权限', '微信', '飞书', 'feishu', 'lark', '绑定', '连接', '配对',
  '位置', '在哪', '改名字', '改名', '叫你', '叫我', '管理应用', 'app 列表',
  'install tool', 'tool factory', 'generated tool', 'review tool', 'register tool',
  'uninstall', 'plugin', 'security', 'sandbox', 'wechat',
  'connect ', 'location', 'rename', 'apps',
  '规则', '关键词规则', '上下文规则', '记忆注入',
  'rule', 'rules', 'context rule', 'keyword rule', 'memory injection',
  '能力槽', 'api能力', 'api 能力', 'api文档', 'api 文档', '配置文档', '执行说明',
  '视觉模型', '识图模型', '图片模型', '图像模型', 'ocr 模型',
  'capability slot', 'api capability', 'vision model',
]

const FRAUD_INTEL_TRIGGERS = [
  '诈骗案例', '诈骗情报', '最新骗局', '最新诈骗', '新骗局', '新手法',
  '诈骗新闻', '诈骗套路', '骗术', '骗局', '反诈情报', '反诈骗情报',
  'fraud intel', 'fraud intelligence', 'scam news', 'latest scam',
  'fraud cases', 'scam cases', '诈骗案例库', '案例采集', '情报采集',
]

// 触发词 → 工具组的单一数据源。selectTools（按轮注入）和 find_tool（模型主动搜工具）
// 共用它，避免两处各维护一份中文关键词。注：CORE / task / memory / 多模态 mmCaps gate 等
// 特殊注入逻辑仍在 selectTools 里，这里只收录"纯关键词触发的专业组"，正好是 find_tool 要搜的范围。
// 已迁能力（web/hotspot/web/weather）的触发词+工具已移入 capability-registry.js，
// find_tool 改读注册表发现它们，故不再列于此。
export const TOOL_GROUPS = [
  { triggers: FILESYSTEM_TRIGGERS,   tools: FILESYSTEM_TOOLS },
  { triggers: EXEC_TRIGGERS,         tools: EXEC_TOOLS },
  { triggers: MEDIA_TRIGGERS,        tools: MEDIA_TOOLS },
  { triggers: REMINDER_TRIGGERS,     tools: REMINDER_TOOLS },
  { triggers: PREFETCH_TRIGGERS,     tools: PREFETCH_TOOLS },
  { triggers: TICKER_TRIGGERS,       tools: TICKER_TOOLS },
  { triggers: TERMINAL_STREAM_TRIGGERS, tools: TERMINAL_STREAM_TOOLS },
  { triggers: CAPABILITY_DEMO_TRIGGERS, tools: CAPABILITY_DEMO_TOOLS },
  { triggers: ADMIN_TRIGGERS,        tools: ADMIN_TOOLS },
  { triggers: FRAUD_INTEL_TRIGGERS,  tools: ['fraud_intel'] },
]

// 通用辅助：消息正文里是否含有给定触发词之一（lower-case 包含）。
// 全部走 includes —— 中文不需要词边界，英文混进来无所谓多注入。
function hits(body, triggers) {
  if (!body) return false
  for (const t of triggers) {
    if (body.includes(t)) return true
  }
  return false
}

function recentApiCapabilitySetupNeed(recentActionLog = []) {
  if (!Array.isArray(recentActionLog)) return false
  return recentActionLog.some(entry => {
    const tool = String(entry?.tool || '')
    if (tool !== 'analyze_image' && tool !== 'manage_api_capability') return false
    const text = `${entry?.status || ''} ${entry?.error || ''} ${entry?.result_preview || ''} ${entry?.args_json || ''}`
    return /not_configured|slot_not_found|credential_not_configured|api_key required|configure|capability/i.test(text)
  })
}

export function selectTools(ctx = {}) {
  const {
    messageBody = '',
    isTick = false,
    senderId = null,
    hasTask = false,
    hasRecall = false,
    mmCaps = [],
    recentActionLog = [],
    installedToolNames = [],
    startupSelfCheckActive = false,
    localVisualTurn = true,
    fastUserPath = false,
  } = ctx

  const body = (messageBody || '').toLowerCase()
  const out = new Set(CORE_TOOLS)
  // 被显式抑制的工具名:ActionLog 保活 / installed 列表 / fallback 兜底都要跳过,
  // 最后一道 delete 兜底,确保不被任何路径加回来。用于跨 turn 抑制 set_tick_interval 等，以及挡住已移除的旧工具名。

  // 任务控制：有任务 → 全组；没任务 → 仅 set_task（用户能开任务）
  for (const t of (hasTask ? TASK_CTRL_FULL : TASK_CTRL_OPENER)) out.add(t)

  // 记忆搜索：跟原行为对齐
  if (senderId || hasRecall || isTick) out.add('search_memory')

  // probe_memory：无副作用的诊断工具，主 agent 想自检"如果现在问 X，会拉到什么"时用。
  // 跟 search_memory 同一触发条件——任何会需要 search_memory 的场景都可能想用 probe_memory。
  if (senderId || hasRecall || isTick) out.add('probe_memory')

  // 启动自检：一次性固定流程，依次检查文件读写、热点面板和视频模式。
  if (startupSelfCheckActive) {
    for (const t of STARTUP_SELF_CHECK_TOOLS) out.add(t)
  }

  // —— 按关键词逐组判断 ——

  if (hits(body, FILESYSTEM_TRIGGERS)) {
    for (const t of FILESYSTEM_TOOLS) out.add(t)
  }
  if (hits(body, EXEC_TRIGGERS)) {
    for (const t of EXEC_TOOLS) out.add(t)
  }
  if (hits(body, MEDIA_TRIGGERS)) {
    for (const t of MEDIA_TOOLS) out.add(t)
    // 媒体场景常需要先联网找链接——尤其视频要 web_search 搜到可嵌入的 B 站 BV 才能播。
    // 不一并注入 web 工具的话，模型拿不到 web_search，会误以为"没有联网搜索"而直接放弃找视频
    // （这是"找的视频不能播放/找不到视频"的一个隐藏根因）。音乐用不到也无妨。
    for (const t of WEB_TOOLS) out.add(t)
  }
  if (hits(body, REMINDER_TRIGGERS)) {
    for (const t of REMINDER_TOOLS) out.add(t)
  }
  if (hits(body, PREFETCH_TRIGGERS)) {
    for (const t of PREFETCH_TOOLS) out.add(t)
  }
  // Cadence is part of the model's heartbeat judgment. Keep the control visible
  // on every Tick instead of hiding it while a previous choice is active;
  // ticker.js still makes identical repeated settings idempotent.
  if (hits(body, TICKER_TRIGGERS) || isTick) {
    for (const t of TICKER_TOOLS) out.add(t)
  }
  // —— 能力注册表：已迁能力（web / hotspot / web/weather）的工具注入 ——
  // 每个能力用自己的 toolWhen 门（web=关键词、hotspot=不自动、
  const capCtx = { text: body, rawText: messageBody, isTick, mmCaps, hasTask }
  for (const t of capabilityToolsFor(capCtx)) out.add(t)
  if (INLINE_IMAGE_RE.test(messageBody)) out.add('analyze_image')
  if (hits(body, TERMINAL_STREAM_TRIGGERS)) {
    for (const t of TERMINAL_STREAM_TOOLS) out.add(t)
  }
  if (!isTick && localVisualTurn !== false && shouldInjectCapabilityDemo(messageBody)) {
    for (const t of CAPABILITY_DEMO_TOOLS) out.add(t)
  }
  if (hits(body, ADMIN_TRIGGERS)) {
    for (const t of ADMIN_TOOLS) out.add(t)
  }
  if (
    (API_KEY_RE.test(messageBody) && API_DOCS_RE.test(messageBody))
    || (API_CONFIG_CONFIRM_RE.test(body.trim()) && recentApiCapabilitySetupNeed(recentActionLog))
  ) {
    out.add('manage_api_capability')
  }
  // Tick 不再因为"它是 Tick"就预先装载 web/filesystem/reminder/prefetch/hotspot。
  // 主模型先判断要做什么，再通过常驻 find_tool 加载所需能力。记忆和 cadence
  // 控制保留在基线中，因为它们直接构成心跳自身的认知与节奏。

  // —— ActionLog 保活 ——
  // 上轮（或最近 10 次）调用过的工具强制带上：跨轮工作流不能因为关键词没命中就断链。
  // 保活只覆盖小盾的"已知工具"——installed 工具走单独的全注入路径。
  // 被抑制的工具跳过，避免 ActionLog 或扩展工具列表把明确撤下的旧工具捞回来。
  if (Array.isArray(recentActionLog)) {
    for (const entry of recentActionLog) {
      const name = entry?.tool
      if (typeof name === 'string' && name) out.add(name)
    }
  }

  // —— 用户安装的扩展工具 ——
  // 用户轮保持原有便利；自主 Tick 由 find_tool 按需发现。最近实际用过的扩展仍会由
  // 上面的 ActionLog 连贯性通道保活，不会打断正在进行的工作流。
  if (!isTick && Array.isArray(installedToolNames)) {
    for (const name of installedToolNames) {
      if (name) out.add(name)
    }
  }

  // —— Fastpath 收紧（可选） ——
  // 实时用户消息：保留 core + web 兜底 + 已命中关键词的所有组，不再额外补。
  // 当前实现里 fastUserPath 只是个 hint——上面的策略已经天然偏紧；这里仅
  // 防御性地不做扩张。（不在 fastpath 里删工具，避免误删导致 agent "我不能"）
  void fastUserPath

  // —— Fallback 安全网 ——
  // 目标：避免"消息没传明确意图、agent 啥专业能力都没有"的尴尬。
  // 阈值算法：CORE=7 + 通常 set_task=1 + senderId 带来 search_memory=1 = 9 是常态基线。
  // < 12 大致表示"基线之外几乎没多组专业能力"，此时补两组最常用兜底（web + filesystem）。
  if (!isTick && out.size < 12) {
    for (const t of WEB_TOOLS) out.add(t)
    for (const t of FILESYSTEM_TOOLS) out.add(t)
  }

  // 最后一道兜底:被 suppressed 的工具不论谁加回来都剃掉。
  // 防御未来扩展时(新分组、新 fallback、新 marketplace 路径)破坏抑制语义。

  return [...out]
}
