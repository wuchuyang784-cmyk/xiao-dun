import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

// brain-ui 是浏览器端纯 ESM（依赖 document/window），无法在 node:test 里直接 import。
// 这里从真实源码中抽出 SLASH_COMMANDS / filterSlash / slashQuery 三段实现并实例化，
// 断言的是**真实代码**而非副本：源码逻辑一旦改动，抽取或断言会立刻失败。
const CHAT_JS = fileURLToPath(new URL('../src/ui/brain-ui/chat.js', import.meta.url))
const source = readFileSync(CHAT_JS, 'utf8')

function extract(pattern, name) {
  const matched = source.match(pattern)
  assert.ok(matched, `未能从 chat.js 抽取 ${name}，源码结构可能已变更`)
  return matched[0]
}

const slashCommandsSrc = extract(/const SLASH_COMMANDS = \[[\s\S]*?\n {2}\];/, 'SLASH_COMMANDS')
const filterSlashSrc = extract(/function filterSlash\(q\) \{[\s\S]*?\n {2}\}/, 'filterSlash')
const slashQuerySrc = extract(/function slashQuery\(\) \{[\s\S]*?\n {2}\}/, 'slashQuery')

// 最小 DOM 替身：只需满足 run() 里用到的 value / focus
function makeInput(value = '') {
  return { value, style: {}, scrollHeight: 0, focusCount: 0, focus() { this.focusCount += 1 } }
}

function buildCommands(msgInput) {
  const factory = new Function(
    'msgInput', 'autoGrowInput', 'openSettings', 'openHotspot', 'openRagManager',
    'triggerContextCompress', 'showContextStats', 'showSlashHelp',
    `${slashCommandsSrc}\nreturn SLASH_COMMANDS;`,
  )
  const noop = () => {}
  return factory(msgInput, noop, noop, noop, noop, noop, noop, noop)
}

function buildFilter(commands) {
  return new Function('SLASH_COMMANDS', `${filterSlashSrc}\nreturn filterSlash;`)(commands)
}

function buildQuery(msgInput) {
  return new Function('msgInput', `${slashQuerySrc}\nreturn slashQuery;`)(msgInput)
}

/** 模拟"用户在输入框敲下 raw 字符串"后菜单实际会列出的命令 */
function menuFor(raw) {
  const input = makeInput(raw)
  const commands = buildCommands(input)
  const query = buildQuery(input)(  )
  return buildFilter(commands)(query).map(c => c.cmd)
}

test('SLASH_COMMANDS 新增 /check_link 与 /check_sms，且字段结构与既有命令一致', () => {
  const commands = buildCommands(makeInput())
  const added = commands.filter(c => c.cmd === '/check_link' || c.cmd === '/check_sms')
  assert.equal(added.length, 2, '应恰好新增两条命令')

  for (const c of added) {
    assert.equal(typeof c.cmd, 'string')
    assert.ok(Array.isArray(c.keys) && c.keys.length > 0, `${c.cmd} 的 keys 应为非空数组`)
    assert.equal(typeof c.label, 'string')
    assert.equal(typeof c.desc, 'string')
    assert.equal(typeof c.run, 'function', `${c.cmd} 的 run 应为函数`)
    assert.equal(c.run.length, 0, `${c.cmd} 的 run 应为无参函数`)
    assert.ok(c.keys.includes('check'), `${c.cmd} 的 keys 应包含 "check" 以支持 /check 前缀匹配`)
  }

  assert.equal(commands.find(c => c.cmd === '/check_link').label, '验链接')
  assert.equal(commands.find(c => c.cmd === '/check_sms').label, '验短信')
})

test('SLASH_COMMANDS exposes one unified /risk_assess command with Chinese search aliases', () => {
  const commands = buildCommands(makeInput())
  const risk = commands.filter(c => c.cmd === '/risk_assess')
  assert.equal(risk.length, 1)
  assert.ok(risk[0].keys.includes('风险研判'))
  assert.ok(risk[0].keys.includes('诈骗研判'))
  assert.equal(typeof risk[0].run, 'function')
  assert.equal(risk[0].run.length, 0)
  assert.deepEqual(menuFor('/risk'), ['/risk_assess'])
  assert.deepEqual(menuFor('/风险研判'), ['/risk_assess'])
})

test('命令表无重复 cmd —— 两条命令共用 "check" key 不会造成条目冲突', () => {
  const cmds = buildCommands(makeInput()).map(c => c.cmd)
  assert.equal(new Set(cmds).size, cmds.length, `存在重复命令：${cmds.join(', ')}`)
})

test('输入 /check 应命中且仅命中验链接与验短信，不再显示"无匹配命令"', () => {
  const hit = menuFor('/check')
  assert.deepEqual(hit, ['/check_link', '/check_sms'])
})

test('前缀 /c /ch /che 逐级输入均能命中两条新命令', () => {
  for (const raw of ['/che', '/chec', '/check']) {
    const hit = menuFor(raw)
    assert.ok(hit.includes('/check_link'), `${raw} 应命中 /check_link，实际：${hit.join(', ')}`)
    assert.ok(hit.includes('/check_sms'), `${raw} 应命中 /check_sms，实际：${hit.join(', ')}`)
  }
})

test('输入完整命令时精确收敛到单条', () => {
  assert.deepEqual(menuFor('/check_link'), ['/check_link'])
  assert.deepEqual(menuFor('/check_sms'), ['/check_sms'])
  assert.deepEqual(menuFor('/risk_assess'), ['/risk_assess'])
})

test('中文关键词与大小写/空格归一化均可命中', () => {
  assert.deepEqual(menuFor('/验链接'), ['/check_link'])
  assert.deepEqual(menuFor('/验短信'), ['/check_sms'])
  assert.deepEqual(menuFor('/CHECK'), ['/check_link', '/check_sms'], '应忽略大小写')
  assert.deepEqual(menuFor('/  check  '), ['/check_link', '/check_sms'], '应忽略首尾空格')
  // "诈骗" 同时命中两条：filter 对每条命令只求值一次，不会产生重复项
  const fraud = menuFor('/诈骗')
  assert.deepEqual(fraud, ['/check_link', '/check_sms', '/risk_assess', '/fraud_intel'])
  assert.equal(new Set(fraud).size, fraud.length, '多 key 同时命中不应产生重复条目')
})

test('十字架按钮路径（空 query）列出全部命令，含两条新命令', () => {
  const commands = buildCommands(makeInput())
  // openSlashMenuFromButton 使用 SLASH_COMMANDS.slice()，等价于 filterSlash("")
  const all = buildFilter(commands)('').map(c => c.cmd)
  assert.equal(all.length, commands.length, '空 query 应返回全部命令')
  assert.ok(all.includes('/check_link'))
  assert.ok(all.includes('/check_sms'))
})

test('点击菜单项后 run() 预填命令并把焦点交回输入框', () => {
  const input = makeInput('/check')
  const commands = buildCommands(input)

  // runSlash 会先清空输入框再执行 c.run()
  input.value = ''
  commands.find(c => c.cmd === '/check_link').run()
  assert.equal(input.value, '/check_link ', '应预填 "/check_link "（含尾随空格）')
  assert.equal(input.focusCount, 1, '应重新聚焦输入框')

  input.value = ''
  commands.find(c => c.cmd === '/check_sms').run()
  assert.equal(input.value, '/check_sms ')
  assert.equal(input.focusCount, 2)
})

test('runSlash 的清空发生在 run() 之前，预填不会被清掉', () => {
  const runSlashSrc = extract(/function runSlash\(c\) \{[\s\S]*?\n {2}\}/, 'runSlash')
  const clearIdx = runSlashSrc.indexOf('msgInput.value = ""')
  const runIdx = runSlashSrc.indexOf('c.run()')
  assert.ok(clearIdx >= 0 && runIdx >= 0)
  assert.ok(clearIdx < runIdx, 'msgInput.value = "" 必须在 c.run() 之前，否则预填会被清空')
})

test('/help、输入框菜单、十字架菜单共用同一份 SLASH_COMMANDS（单一数据源）', () => {
  // 三处消费点都必须直接引用 SLASH_COMMANDS，不得维护第二份列表
  assert.match(filterSlashSrc, /SLASH_COMMANDS/, 'filterSlash 应消费 SLASH_COMMANDS')

  const openFromButtonSrc = extract(
    /function openSlashMenuFromButton\(\) \{[\s\S]*?\n {2}\}/,
    'openSlashMenuFromButton',
  )
  assert.match(openFromButtonSrc, /SLASH_COMMANDS\.slice\(\)/, '十字架菜单应直接取 SLASH_COMMANDS')

  const helpSrc = extract(/function showSlashHelp\(\) \{[\s\S]*?\n {2}\}/, 'showSlashHelp')
  assert.match(helpSrc, /SLASH_COMMANDS\.map/, '/help 应遍历 SLASH_COMMANDS 生成列表')

  // 全文件只允许出现一次 SLASH_COMMANDS 的定义
  const declarations = source.match(/const SLASH_COMMANDS\s*=/g) || []
  assert.equal(declarations.length, 1, '不应存在第二份命令列表定义')
})

test('/help 输出会包含两条新命令的 label 与 desc', () => {
  const commands = buildCommands(makeInput())
  const lines = commands.map(c => `· \`${c.cmd}\` — ${c.label}：${c.desc}`).join('\n')
  assert.match(lines, /`\/check_link` — 验链接：/)
  assert.match(lines, /`\/check_sms` — 验短信：/)
})

// —— 已知行为记录（非阻塞）——
// 预填 "/check_link " 后用户继续输入 URL，输入框内容仍以 "/" 开头，
// updateSlashMenu 会再次过滤并命中 0 条，从而弹出"无匹配命令"浮层。
// 记录该行为以便后续若修复能被本用例感知。
test('[已知行为] 预填后继续输入参数会过滤为 0 条（触发"无匹配命令"浮层）', () => {
  assert.deepEqual(menuFor('/check_link https://example.com'), [])
  assert.deepEqual(menuFor('/check_sms 您的快递已到付'), [])
})


test('legacy /rag command is not exposed after the China heatmap became the default view', () => {
  const commands = buildCommands(makeInput())
  assert.equal(commands.some(command => command.cmd === '/rag'), false)
  assert.equal(source.includes('cmd: "/rag"'), false)

  const appShell = readFileSync(fileURLToPath(new URL('../src/ui/brain-ui/app-shell.js', import.meta.url)), 'utf8')
  assert.doesNotMatch(appShell, /rag-boot-overlay|rag-boot-title|rag-close/)

  const fraudMap = readFileSync(fileURLToPath(new URL('../src/ui/brain-ui/fraud-map.js', import.meta.url)), 'utf8')
  assert.ok(fraudMap.includes('void reconcile().then(() => render(store.getState()))'))
})
