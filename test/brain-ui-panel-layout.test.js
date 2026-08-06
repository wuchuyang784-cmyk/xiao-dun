import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createBrainUiMarkup } from '../src/ui/brain-ui/app-shell.js'

// 本文件验证「左右面板缩进收起按钮移入面板内部」这次布局改动：
//  - DOM 结构断言跑在 app-shell.js **真实产出的 markup** 上（该模块是纯模板函数，可在 Node 直接 import）
//  - CSS 断言跑在 styles.css **真实源文件**解析出的规则上
// 没有 jsdom / 浏览器，因此不校验像素级渲染结果，只校验结构与声明。

const SRC = new URL('../src/ui/brain-ui/', import.meta.url)
const readSrc = (name) => readFileSync(fileURLToPath(new URL(name, SRC)), 'utf8')

const MARKUP = createBrainUiMarkup()
const CSS_TEXT = readSrc('styles.css')
const APP_SHELL_TEXT = readSrc('app-shell.js')
const PANEL_COLLAPSE_TEXT = readSrc('panel-collapse.js')

// ──────────────────────────────── 极简 HTML 结构解析 ────────────────────────────────

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
])

const TAG_RE = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g

/** 取出 html 中 id=<id> 的元素，返回 { tag, attrs, inner } */
function elementById(html, id) {
  const marker = html.indexOf(`id="${id}"`)
  assert.notEqual(marker, -1, `markup 中找不到 id="${id}"`)
  const start = html.lastIndexOf('<', marker)
  const tag = /^<([a-zA-Z][\w-]*)/.exec(html.slice(start))[1]
  const openEnd = html.indexOf('>', marker) + 1
  const attrs = html.slice(start + 1 + tag.length, openEnd - 1)

  if (VOID_TAGS.has(tag.toLowerCase()) || attrs.trimEnd().endsWith('/')) {
    return { tag, attrs, inner: '' }
  }

  const scan = new RegExp(`</?${tag}\\b[^>]*>`, 'gi')
  scan.lastIndex = openEnd
  let depth = 1
  let m
  while ((m = scan.exec(html))) {
    depth += m[0].startsWith('</') ? -1 : 1
    if (depth === 0) return { tag, attrs, inner: html.slice(openEnd, m.index) }
  }
  throw new Error(`id="${id}" 的 <${tag}> 标签未闭合`)
}

/** 列出一段 inner HTML 的直接子元素 */
function directChildren(inner) {
  const children = []
  let depth = 0
  let startIdx = -1
  let pending = null
  let m
  TAG_RE.lastIndex = 0
  while ((m = TAG_RE.exec(inner))) {
    if (m[0].startsWith('<!--')) continue
    if (m[1]) {
      depth -= 1
      if (depth === 0 && pending) {
        children.push({ ...pending, outer: inner.slice(startIdx, TAG_RE.lastIndex) })
        pending = null
        startIdx = -1
      }
      continue
    }
    const tag = m[2].toLowerCase()
    const attrs = m[3] || ''
    if (m[4] === '/' || VOID_TAGS.has(tag)) {
      if (depth === 0) children.push({ tag, attrs, outer: m[0] })
      continue
    }
    if (depth === 0) {
      startIdx = m.index
      pending = { tag, attrs }
    }
    depth += 1
  }
  return children
}

const attrOf = (attrs, name) => {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)
  return m ? m[1] : null
}
const classList = (attrs) => (attrOf(attrs, 'class') || '').split(/\s+/).filter(Boolean)
const hasClass = (node, cls) => classList(node.attrs).includes(cls)

// ──────────────────────────────── 极简 CSS 解析 ────────────────────────────────

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** 解析成 [{ selector, body, media }]，@media 内的规则带上 media 前提 */
function parseRules(css, media = null, out = []) {
  let buf = ''
  let i = 0
  while (i < css.length) {
    const ch = css[i]
    if (ch === '{') {
      const prelude = buf.trim()
      buf = ''
      let depth = 1
      let j = i + 1
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth += 1
        else if (css[j] === '}') depth -= 1
        j += 1
      }
      const body = css.slice(i + 1, j - 1)
      if (/^@(media|supports|layer|container)\b/.test(prelude)) parseRules(body, prelude, out)
      else if (!prelude.startsWith('@')) out.push({ selector: prelude, body, media })
      i = j
      continue
    }
    if (ch === '}') { buf = ''; i += 1; continue }
    buf += ch
    i += 1
  }
  return out
}

const RULES = parseRules(stripCssComments(CSS_TEXT))

function declsOf(body) {
  const decls = {}
  for (const chunk of body.split(';')) {
    const idx = chunk.indexOf(':')
    if (idx === -1) continue
    const prop = chunk.slice(0, idx).trim().toLowerCase()
    const value = chunk.slice(idx + 1).trim()
    if (prop) decls[prop] = value.replace(/\s+/g, ' ')
  }
  return decls
}

const selectorParts = (selector) => selector.split(',').map((s) => s.trim()).filter(Boolean)

/** 收集所有命中 <selector 完全相等的某个逗号分支> 的规则声明，按源码顺序合并 */
function computed(selectorPart, { media = null } = {}) {
  const merged = {}
  for (const rule of RULES) {
    if (rule.media !== media && !(media && rule.media && rule.media.includes(media))) {
      if (rule.media !== media) continue
    }
    if (!selectorParts(rule.selector).includes(selectorPart)) continue
    Object.assign(merged, declsOf(rule.body))
  }
  return merged
}

/** 该选择器分支在任何规则中出现过的所有声明（不分 media），用于「不应存在某属性」类断言 */
function anyDecl(selectorPart, prop) {
  const hits = []
  for (const rule of RULES) {
    if (!selectorParts(rule.selector).includes(selectorPart)) continue
    const decls = declsOf(rule.body)
    if (prop in decls) hits.push({ media: rule.media, value: decls[prop] })
  }
  return hits
}

/**
 * 简化版特异性计算：只覆盖本项目用到的「类型 + class + id + 伪类」复合后代选择器。
 * 返回 [ids, classes, types]，可直接按数组字典序比较。
 */
function specificity(selectorPart) {
  const s = selectorPart.replace(/::[\w-]+/g, ' ')
  const ids = (s.match(/#[\w-]+/g) || []).length
  const classes =
    (s.match(/\.[\w-]+/g) || []).length +
    (s.match(/\[[^\]]*\]/g) || []).length +
    (s.match(/:(?!:)[\w-]+/g) || []).length
  const types = (s.replace(/[#.:[][^\s]*/g, ' ').match(/\b[a-zA-Z][\w-]*\b/g) || []).length
  return [ids, classes, types]
}

const cmpSpec = (a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2])

// ════════════════════════════════ A. DOM 结构 ════════════════════════════════

test('A1 #panel-l1-tab 是 <aside id="panel-l1"> 的直接子节点', () => {
  const panel = elementById(MARKUP, 'panel-l1')
  assert.equal(panel.tag, 'aside')
  const kids = directChildren(panel.inner)
  const tab = kids.find((k) => attrOf(k.attrs, 'id') === 'panel-l1-tab')
  assert.ok(tab, `#panel-l1-tab 不是 #panel-l1 的直接子节点，实际直接子节点：${kids.map((k) => k.tag + (attrOf(k.attrs, 'id') ? '#' + attrOf(k.attrs, 'id') : '')).join(', ')}`)
  assert.equal(tab.tag, 'button')
  assert.deepEqual(classList(tab.attrs), ['panel-tab', 'panel-tab-left'])
  assert.ok(attrOf(tab.attrs, 'aria-label'), '#panel-l1-tab 缺少 aria-label')
})

test('A2 #panel-l2-tab 是 <aside id="panel-l2"> 的直接子节点', () => {
  const panel = elementById(MARKUP, 'panel-l2')
  assert.equal(panel.tag, 'aside')
  const kids = directChildren(panel.inner)
  const tab = kids.find((k) => attrOf(k.attrs, 'id') === 'panel-l2-tab')
  assert.ok(tab, `#panel-l2-tab 不是 #panel-l2 的直接子节点，实际直接子节点：${kids.map((k) => k.tag + (attrOf(k.attrs, 'id') ? '#' + attrOf(k.attrs, 'id') : '')).join(', ')}`)
  assert.equal(tab.tag, 'button')
  assert.deepEqual(classList(tab.attrs), ['panel-tab', 'panel-tab-right'])
  assert.ok(attrOf(tab.attrs, 'aria-label'), '#panel-l2-tab 缺少 aria-label')
})

test('A3 左面板：.panel-body 唯一且包住 header/stream，按钮在 .panel-body 之外', () => {
  const panel = elementById(MARKUP, 'panel-l1')
  const kids = directChildren(panel.inner)
  const bodies = kids.filter((k) => hasClass(k, 'panel-body'))
  assert.equal(bodies.length, 1, '#panel-l1 下应恰好有 1 个直接子 .panel-body')

  const body = bodies[0]
  assert.match(body.outer, /class="panel-identity"/, '.panel-body 未包住 .panel-identity')
  assert.match(body.outer, /id="si-l1"/, '.panel-body 未包住 #si-l1 消息流')
  assert.match(body.outer, /id="voice-panel"/, '.panel-body 未包住 #voice-panel')
  assert.doesNotMatch(body.outer, /id="panel-l1-tab"/, '收起按钮不应被包进 .panel-body（否则折叠时会跟着滑走）')
})

test('A4 右面板：.panel-body 唯一且包住 stats/plan/stream，按钮在 .panel-body 之外', () => {
  const panel = elementById(MARKUP, 'panel-l2')
  const kids = directChildren(panel.inner)
  const bodies = kids.filter((k) => hasClass(k, 'panel-body'))
  assert.equal(bodies.length, 1, '#panel-l2 下应恰好有 1 个直接子 .panel-body')

  const body = bodies[0]
  assert.match(body.outer, /class="panel-stats"/, '.panel-body 未包住 .panel-stats')
  assert.match(body.outer, /id="plan-list"/, '.panel-body 未包住 #plan-list 规划区')
  assert.match(body.outer, /id="si-l2"/, '.panel-body 未包住 #si-l2 消息流')
  assert.doesNotMatch(body.outer, /id="panel-l2-tab"/, '收起按钮不应被包进 .panel-body（否则折叠时会跟着滑走）')
})

test('A5 右面板按钮排在 .panel-body 之前（独占首行，不压规划区）', () => {
  const kids = directChildren(elementById(MARKUP, 'panel-l2').inner)
  const tabIdx = kids.findIndex((k) => attrOf(k.attrs, 'id') === 'panel-l2-tab')
  const bodyIdx = kids.findIndex((k) => hasClass(k, 'panel-body'))
  assert.ok(tabIdx >= 0 && bodyIdx >= 0)
  assert.ok(tabIdx < bodyIdx, '#panel-l2-tab 必须排在 .panel-body 之前，否则 flex 首行不成立')
})

test('A6 panel-collapse.js 的所有 getElementById 选择器都能在 markup 中命中（无悬挂引用）', () => {
  const ids = [...PANEL_COLLAPSE_TEXT.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1])
  assert.ok(ids.length >= 2, 'panel-collapse.js 中应至少监听 2 个按钮')
  for (const id of ids) {
    assert.ok(MARKUP.includes(`id="${id}"`), `panel-collapse.js 监听了 #${id}，但 markup 里不存在`)
  }
})

test('A7 旧的 createPanelTabs() 已彻底移除，且 tab id 全局唯一', () => {
  assert.doesNotMatch(APP_SHELL_TEXT, /createPanelTabs/, 'app-shell.js 仍残留 createPanelTabs')
  for (const id of ['panel-l1-tab', 'panel-l2-tab']) {
    const count = MARKUP.split(`id="${id}"`).length - 1
    assert.equal(count, 1, `#${id} 在 markup 中出现 ${count} 次，应恰好 1 次`)
  }
})

test('A8 #cross-menu-btn 十字架按钮未被波及', () => {
  assert.match(MARKUP, /id="cross-menu-btn"/)
  const btn = elementById(MARKUP, 'cross-menu-btn')
  assert.equal(btn.tag, 'button')
  assert.equal(attrOf(btn.attrs, 'aria-controls'), 'slash-menu')
})

// ─────────────────── 自定义属性求值（几何断言用） ───────────────────
// 按钮坐标由 --panel-w / --tab-size / --tab-inset 推导，断言直接比对「解析后的像素」，
// 这样工程师换任何等价写法（换变量名、直接写死数值）测试都成立，只锁最终几何。

const pickVars = (decls) =>
  Object.fromEntries(Object.entries(decls).filter(([k]) => k.startsWith('--')))

/** 汇总 .panel（继承）+ .panel-tab（自身）上声明的自定义属性 */
function tabScope({ media = null } = {}) {
  const scope = {}
  for (const sel of ['.panel', '.panel-tab']) Object.assign(scope, pickVars(computed(sel)))
  if (media) for (const sel of ['.panel', '.panel-tab']) Object.assign(scope, pickVars(computed(sel, { media })))
  return scope
}

/** 递归展开 var(--x)（支持 fallback） */
function expandVars(value, scope) {
  let out = String(value)
  for (let i = 0; i < 10 && out.includes('var('); i += 1) {
    const next = out.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g, (_m, name, fallback) =>
      scope[name] !== undefined ? scope[name] : (fallback ?? ''))
    if (next === out) break
    out = next
  }
  return out
}

/** 求值只含 +/- 的纯 px 表达式（含 calc(...)），非纯 px 返回 NaN */
function evalPx(expr) {
  const trimmed = String(expr).trim()
  const body = (/^calc\(([\s\S]*)\)$/.exec(trimmed)?.[1] ?? trimmed).replace(/\s+/g, '')
  if (!body || !/^[-+\d.]+(px)?([-+][\d.]+(px)?)*$/.test(body)) return NaN
  const parts = body.replace(/px/g, '').split(/(?=[-+])/).map((s) => parseFloat(s))
  return parts.some(Number.isNaN) ? NaN : parts.reduce((a, b) => a + b, 0)
}

/** 解析某选择器上某属性的最终像素值（media 内优先，回退到基础规则） */
function px(selectorPart, prop, { media = null } = {}) {
  const raw = (media ? computed(selectorPart, { media })[prop] : undefined) ?? computed(selectorPart)[prop]
  if (raw === undefined) return undefined
  return evalPx(expandVars(raw, tabScope({ media })))
}

/** 面板 padding box 宽度（--panel-w 去掉左右各 1px 边框），absolute 子元素的定位参照 */
const paddingBoxW = ({ media = null } = {}) =>
  evalPx(expandVars('var(--panel-w)', tabScope({ media }))) - 2

// ════════════════════════════════ B. CSS 布局 ════════════════════════════════

test('B0 styles.css 花括号配平、规则可解析', () => {
  const clean = stripCssComments(CSS_TEXT)
  let depth = 0
  let min = 0
  for (const ch of clean) {
    if (ch === '{') depth += 1
    else if (ch === '}') { depth -= 1; if (depth < min) min = depth }
  }
  assert.equal(depth, 0, 'styles.css 花括号未配平')
  assert.equal(min, 0, 'styles.css 出现多余的右花括号')
  assert.ok(RULES.length > 500, `解析出的规则数异常偏少：${RULES.length}`)
})

test('B1 左按钮：展开贴左面板内部右上角，折叠迁移到主视口左上角', () => {
  const inset = evalPx(expandVars('var(--tab-inset)', tabScope()))
  const size = evalPx(expandVars('var(--tab-size)', tabScope()))
  assert.ok(inset > 0 && size > 0, `--tab-inset/--tab-size 未解析出有效尺寸：${inset}/${size}`)

  // 展开态：按钮右外沿距面板右内边恰好一个留白 ⇒ 停在面板内部右上角
  const expandedLeft = px('.panel-tab-left', 'left')
  assert.ok(Number.isFinite(expandedLeft), '.panel-tab-left 展开态缺少可解析的 left 坐标')
  assert.equal(paddingBoxW() - (expandedLeft + size), inset,
    `展开态左按钮距面板右内边应为 ${inset}px，实际 ${paddingBoxW() - (expandedLeft + size)}px`)

  // 折叠态：贴住面板 padding box 左内边 —— 面板左内边即主视口左上角
  const collapsedLeft = px('body.l1-collapsed .panel-tab-left', 'left')
  assert.equal(collapsedLeft, 0, `折叠态左按钮应迁移到视口左上角(left:0)，实际 ${collapsedLeft}`)
  assert.ok(collapsedLeft < expandedLeft, '折叠时左按钮必须向左迁移')
})

test('B2 右按钮：展开贴右面板内部左上角，折叠迁移到主视口右上角', () => {
  const inset = evalPx(expandVars('var(--tab-inset)', tabScope()))
  const size = evalPx(expandVars('var(--tab-size)', tabScope()))

  const expandedRight = px('.panel-tab-right', 'right')
  assert.ok(Number.isFinite(expandedRight), '.panel-tab-right 展开态缺少可解析的 right 坐标')
  assert.equal(paddingBoxW() - (expandedRight + size), inset,
    `展开态右按钮距面板左内边应为 ${inset}px，实际 ${paddingBoxW() - (expandedRight + size)}px`)

  const collapsedRight = px('body.l2-collapsed .panel-tab-right', 'right')
  assert.equal(collapsedRight, 0, `折叠态右按钮应迁移到视口右上角(right:0)，实际 ${collapsedRight}`)
  assert.ok(collapsedRight < expandedRight, '折叠时右按钮必须向右迁移')

  // 绝对定位后不再占 flex 行，必须给 .panel-body 让出等高空档，否则会压住统计行
  const reserved = px('#panel-l2 .panel-body', 'margin-top')
  assert.equal(reserved, inset + size,
    `#panel-l2 .panel-body 应预留 ${inset + size}px 顶部空档，实际 ${reserved}`)
})

test('B3 .panel-tab 基类：absolute 定位 + 统一顶部坐标，不是 fixed', () => {
  const d = computed('.panel-tab')
  // fixed 会被 .panel 的 backdrop-filter 变成以面板为包含块，行为不可控；必须用 absolute
  assert.equal(d['position'], 'absolute', '.panel-tab 必须 position:absolute，相对 .panel 定位')
  const top = px('.panel-tab', 'top')
  assert.ok(Number.isFinite(top) && top >= 0, `.panel-tab 需要可解析的 top，实际 ${d['top']}`)
  assert.equal(d['bottom'], undefined, '.panel-tab 不应声明 bottom')
  // 左右坐标交给 .panel-tab-left / -right，基类不得同时给两侧（否则按钮被拉伸）
  assert.equal(d['left'], undefined, '.panel-tab 基类不应声明 left')
  assert.equal(d['right'], undefined, '.panel-tab 基类不应声明 right')
})

test('B4 迁移动画：left/right 参与过渡，且左右按钮各只用一侧坐标', () => {
  const tr = computed('.panel-tab')['transition'] || ''
  assert.match(tr, /\bleft\b/, '.panel-tab 的 transition 必须包含 left，折叠迁移才有过渡动画')
  assert.match(tr, /\bright\b/, '.panel-tab 的 transition 必须包含 right，折叠迁移才有过渡动画')

  // 同一按钮同时声明 left 和 right 会被拉伸变形
  assert.equal(computed('.panel-tab-left')['right'], undefined, '左按钮不应声明 right')
  assert.equal(computed('.panel-tab-right')['left'], undefined, '右按钮不应声明 left')

  // 迁移坐标必须随断点变化（面板变窄，展开态坐标必须跟着变小）
  const wide = px('.panel-tab-left', 'left')
  for (const media of ['@media (max-width: 1180px)', '@media (max-width: 900px)']) {
    const narrow = paddingBoxW({ media }) - evalPx(expandVars('var(--tab-size)', tabScope({ media })))
      - evalPx(expandVars('var(--tab-inset)', tabScope({ media })))
    assert.ok(Number.isFinite(narrow) && narrow < wide,
      `${media} 下展开态坐标应随面板收窄而减小，实际 ${narrow} vs ${wide}`)
  }
})

test('B5 .panel-body 是滚动容器，.panel 自身不再滚动', () => {
  const body = computed('.panel-body')
  assert.equal(body['flex'], '1 1 auto')
  assert.equal(body['min-height'], '0')
  assert.equal(body['overflow'], 'hidden auto')
  assert.match(body['transition'] || '', /transform/, '.panel-body 需要 transform 过渡，折叠动画才平滑')

  const panel = computed('.panel')
  assert.equal(panel['overflow'], 'hidden', '.panel 应为 overflow:hidden，把滚动交给 .panel-body 并裁掉滑出的内容')
  assert.equal(panel['position'], 'fixed', '.panel 必须是定位元素，.panel-tab-left 的 absolute 才有参照')
})

test('B6 折叠时只有 .panel-body 位移，面板本身不再整体平移', () => {
  assert.match(computed('body.l1-collapsed #panel-l1 .panel-body')['transform'] || '', /translateX/)
  assert.match(computed('body.l2-collapsed #panel-l2 .panel-body')['transform'] || '', /translateX/)

  assert.deepEqual(anyDecl('body.l1-collapsed #panel-l1', 'transform'), [],
    'body.l1-collapsed #panel-l1 仍有 transform，按钮会被一起平移出屏幕')
  assert.deepEqual(anyDecl('body.l2-collapsed #panel-l2', 'transform'), [],
    'body.l2-collapsed #panel-l2 仍有 transform，按钮会被一起平移出屏幕')
})

test('B7 折叠态：面板不拦截点击，但按钮常驻可点', () => {
  assert.equal(computed('body.l1-collapsed #panel-l1')['pointer-events'], 'none')
  assert.equal(computed('body.l2-collapsed #panel-l2')['pointer-events'], 'none')
  assert.equal(computed('body.l1-collapsed #panel-l1 .panel-tab')['pointer-events'], 'auto')
  assert.equal(computed('body.l2-collapsed #panel-l2 .panel-tab')['pointer-events'], 'auto')

  // 图标是纯 CSS 绘制（无文字），折叠态要把侧栏条从实心块收成细线以区分状态
  const iconBase = computed('.panel-tab::before')
  assert.equal(iconBase['content'], '""', '图标应为纯图形（content:""），不得再用文字箭头')
  assert.match(iconBase['border'] || '', /currentcolor/i, '图标外框应用 currentColor 描边以跟随主题')
  assert.ok(iconBase['background-size'], '图标需要 background-size 表现侧栏条')

  for (const [sel, side] of [
    ['body.l1-collapsed .panel-tab-left::before', '左'],
    ['body.l2-collapsed .panel-tab-right::before', '右'],
  ]) {
    const collapsedIcon = computed(sel)
    assert.ok(collapsedIcon['background-size'],
      `${side}按钮折叠态需改变 background-size，否则图标不体现收起状态`)
    assert.notEqual(collapsedIcon['background-size'], iconBase['background-size'],
      `${side}按钮折叠态图标与展开态完全一致，用户看不出状态差异`)
  }
})

test('B8 .panel-identity 预留右侧空位，左按钮不会压住 ⚙ 设置按钮', () => {
  const identity = computed('.panel-identity')
  const pr = identity['padding-right']
  assert.ok(pr, '.panel-identity 需要 padding-right 给右上角收起按钮让位')

  const need =
    evalPx(expandVars('var(--tab-inset)', tabScope())) +
    evalPx(expandVars('var(--tab-size)', tabScope()))
  assert.ok(parseFloat(pr) >= need,
    `.panel-identity padding-right=${pr} 小于按钮占位 ${need}px，⚙ 会被压住`)
})

test('B9 桌面断点下 .panel 层级不低于 .console（按钮已被关进 .panel 的层叠上下文）', () => {
  // 改动前 .panel-tab 是 position:fixed，处于根层叠上下文，z-index:10 天然盖过 .console(4)。
  // 改动后按钮成了 .panel 的子节点，而 .panel 是 position:fixed + z-index，自成层叠上下文，
  // 于是按钮的 z-index:10 只在面板内部有效，整体仍按 .panel 的 z-index 与 .console 比较。
  const panelZ = parseInt(computed('.panel')['z-index'], 10)
  const consoleZ = parseInt(computed('.console')['z-index'], 10)
  assert.ok(
    panelZ >= consoleZ,
    `.panel z-index=${panelZ} 低于 .console z-index=${consoleZ}：折叠后残留在面板内的收起按钮会被对话框盖住点不到`,
  )
})

test('B10 窄屏(≤780) 断点下按钮仍有明确尺寸、面板层级高于 console', () => {
  const narrow = '@media (max-width: 780px)'
  const tabNarrow = computed('.panel-tab', { media: narrow })
  assert.ok(tabNarrow['width'] && tabNarrow['height'], '≤780 断点应显式给 .panel-tab 尺寸')

  const panelNarrow = computed('.panel', { media: narrow })
  const consoleZ = parseInt(computed('.console')['z-index'], 10)
  assert.ok(parseInt(panelNarrow['z-index'], 10) > consoleZ,
    '窄屏抽屉必须盖在 .console 之上，否则折叠后的按钮点不到')

  // 让位宽度在窄屏同样成立
  const scope = tabScope({ media: narrow })
  const need =
    evalPx(expandVars('var(--tab-inset)', scope)) +
    evalPx(expandVars('var(--tab-size)', scope))
  assert.ok(parseFloat(computed('.panel-identity')['padding-right']) >= need,
    `窄屏下 .panel-identity 让位不足：需要 ${need}px`)

  // 抽屉宽度是 min(86vw,340px) —— 非纯 px，坐标必须仍由 --panel-w 推导而非写死
  assert.ok(computed('.panel', { media: narrow })['--panel-w'],
    '≤780 断点应覆盖 --panel-w 而不是直接改 width，否则按钮坐标与抽屉宽度脱钩')
})

test('B11 各断点只覆盖 --panel-w，面板宽度与按钮坐标不会脱钩', () => {
  // 只要还有断点直接写 .panel { width: ... }，它就会覆盖 width:var(--panel-w)，
  // 而按钮坐标仍按旧的 --panel-w 计算 —— 展开态按钮会错位。
  const hardWidths = anyDecl('.panel', 'width').filter((h) => h.value !== 'var(--panel-w)')
  assert.deepEqual(hardWidths, [],
    `.panel 仍有写死的 width，会与 --panel-w 脱钩：${JSON.stringify(hardWidths)}`)

  // 每个改过面板宽度的断点都必须给出 --panel-w
  const overrides = anyDecl('.panel', '--panel-w').filter((h) => h.media)
  assert.ok(overrides.length >= 3,
    `应至少有 3 个断点覆盖 --panel-w（1180/900/780），实际 ${overrides.length}`)
})

// ══════════════════════════ C. 层叠求解 + 回归 ══════════════════════════
// 下面几条不再比对「某个写死的选择器字符串」，而是合成一条最小 DOM 链
// （body > aside#panel-lX.panel > button.panel-tab），把 styles.css 的规则
// 按「特异性 → 源码顺序」真正跑一遍，得出该状态下的胜出声明。
// 这样无论工程师用哪种写法修复，只要最终层叠结果正确，测试就通过。

/** 合成 DOM 链：body(带状态类) → aside#panel-lX.panel → button.panel-tab */
function tabChain(bodyClasses, side) {
  return [
    { tag: 'body', id: null, classes: bodyClasses },
    { tag: 'aside', id: `panel-${side}`, classes: ['panel'] },
    {
      tag: 'button',
      id: `panel-${side}-tab`,
      classes: ['panel-tab', side === 'l1' ? 'panel-tab-left' : 'panel-tab-right'],
    },
  ]
}

function compoundMatches(compound, node) {
  const tagMatch = /^[a-zA-Z][\w-]*/.exec(compound)
  if (tagMatch && tagMatch[0].toLowerCase() !== node.tag) return false
  for (const m of compound.matchAll(/\.([\w-]+)/g)) if (!node.classes.includes(m[1])) return false
  for (const m of compound.matchAll(/#([\w-]+)/g)) if (node.id !== m[1]) return false
  return true
}

/** 只支持后代组合符；带伪类/伪元素的规则视为「非默认态」直接跳过 */
function selectorMatchesChain(selectorPart, chain) {
  if (/[>+~]/.test(selectorPart)) return false
  if (/:/.test(selectorPart)) return false
  const compounds = selectorPart.split(/\s+/).filter(Boolean)
  let ci = chain.length - 1
  if (!compoundMatches(compounds.at(-1), chain[ci])) return false
  ci -= 1
  for (let k = compounds.length - 2; k >= 0; k -= 1) {
    let found = false
    while (ci >= 0) {
      if (compoundMatches(compounds[k], chain[ci])) { found = true; ci -= 1; break }
      ci -= 1
    }
    if (!found) return false
  }
  return true
}

/** 按 CSS 层叠规则求出某属性的胜出声明 */
function cascade(chain, prop, { media = null } = {}) {
  let best = null
  RULES.forEach((rule, order) => {
    if ((rule.media || null) !== media) return
    const decls = declsOf(rule.body)
    if (!(prop in decls)) return
    for (const part of selectorParts(rule.selector)) {
      if (!selectorMatchesChain(part, chain)) continue
      const spec = specificity(part)
      const diff = best ? cmpSpec(spec, best.spec) : 1
      if (diff > 0 || (diff === 0 && order >= best.order)) {
        best = { spec, order, value: decls[prop], selector: part }
      }
    }
  })
  return best
}

const MEDIA_MODES = ['video-mode', 'image-mode', 'hotspot-mode', 'doc-panel-mode', 'rag-manager-mode']

test('C1 媒体/文档模式下 .panel-tab 不可点 —— 折叠态的 pointer-events:auto 不得反超', () => {
  const problems = []
  for (const mode of MEDIA_MODES) {
    for (const side of ['l1', 'l2']) {
      const chain = tabChain([mode, `${side}-collapsed`], side)
      const opacity = cascade(chain, 'opacity')
      const pe = cascade(chain, 'pointer-events')
      assert.equal(opacity?.value, '0', `body.${mode} 下 ${side} tab 应 opacity:0（实际 ${opacity?.value}）`)
      if (pe?.value !== 'none') {
        problems.push(
          `body.${mode}.${side}-collapsed：按钮 opacity:0 却拿到 pointer-events:${pe?.value}` +
          `（胜出规则「${pe?.selector}」特异性 ${pe?.spec}）→ 隐形点击陷阱`,
        )
      }
    }
  }
  assert.deepEqual(problems, [], `\n  ${problems.join('\n  ')}\n`)
})

test('C2 非模式态：展开可点、折叠也可点（折叠按钮必须常驻）', () => {
  for (const side of ['l1', 'l2']) {
    const expanded = cascade(tabChain([], side), 'pointer-events')
    assert.ok(expanded === null || expanded.value === 'auto',
      `展开态 ${side} tab 不应被禁用点击，实际 ${expanded?.value}`)

    const collapsed = cascade(tabChain([`${side}-collapsed`], side), 'pointer-events')
    assert.equal(collapsed?.value, 'auto',
      `折叠态 ${side} tab 必须 pointer-events:auto（面板整体是 none），实际 ${collapsed?.value}`)

    const panelChain = tabChain([`${side}-collapsed`], side).slice(0, 2)
    assert.equal(cascade(panelChain, 'pointer-events')?.value, 'none',
      `折叠态 #panel-${side} 面板本体应 pointer-events:none，避免透明面板挡住地图/对话框`)
  }
})

test('C3 折叠断点与 console 收缩规则仍成对存在', () => {
  for (const [side, prop] of [['l1', 'left'], ['l2', 'right']]) {
    const hits = anyDecl(`body.${side}-collapsed .console`, prop)
    assert.ok(hits.length >= 3,
      `body.${side}-collapsed .console 的 ${prop} 规则应覆盖默认 + 三个断点，实际 ${hits.length} 条`)
  }
})
