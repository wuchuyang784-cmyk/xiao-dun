// 案例导入 / 知识库 模式控制：全屏 iframe + body 类 + 状态上报。
// 与 worldcup 完全一致：/ 斜杠命令、agent 事件、自然语言关键词三种方式调出。
import { apiUrl } from './api-client.js'
import { setHotspotMode } from './hotspot.js'
import { setWorldcupMode } from './worldcup.js'

const FRAME_SRC = apiUrl('/src/ui/brain-ui/cases-import.html')

const $ = (id) => document.getElementById(id)
let active = false
let closeTimer = null
// 用户手动关闭（来源 brain-ui：退出按钮 / 斜杠菜单 toggle）的时间戳。
// 用于抑制「用户刚关闭，agent 事件又推一次 show 导致面板自动重开」的观感。
let lastUserCloseAt = 0

// 重播入场动画：复用热点同款 hs-glitch-in（见 styles.css 的 .cases-import-boot 规则）
function replayCasesImportBoot() {
  const panel = document.querySelector('.cases-import-panel')
  if (!panel) return
  panel.classList.remove('cases-import-boot')
  void panel.offsetWidth
  panel.classList.add('cases-import-boot')
}

function reportState(visible, source = 'brain-ui') {
  fetch(apiUrl('/cases-import-state'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: !!visible, source }),
  }).catch(() => {})
}

export function setCasesImportMode(visible, { source = 'brain-ui' } = {}) {
  const next = !!visible
  // 用户手动关闭后的短暂窗口内，忽略 agent 事件驱动的再次打开（仅拦截 agent_event 来源，
  // 不影响用户用 /cases 等显式指令重新打开）。
  if (next === true && source === 'agent_event' && lastUserCloseAt && Date.now() - lastUserCloseAt < 2000) {
    return
  }
  if (active === next) {
    reportState(next, source)
    return
  }
  if (next === false && source === 'brain-ui') {
    lastUserCloseAt = Date.now()
  }
  active = next
  const frame = $('cases-import-frame')
  if (next) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    // 与其他全屏模式互斥
    setHotspotMode(false, { source: 'cases_import_open' })
    setWorldcupMode(false, { source: 'cases_import_open' })
    if (frame) frame.src = FRAME_SRC
    document.body.classList.add('cases-import-mode')
    replayCasesImportBoot()
  } else {
    document.querySelector('.cases-import-panel')?.classList.remove('cases-import-boot')
    const loaded = !!(frame && frame.src && !frame.src.includes('about:blank'))
    const finish = () => {
      closeTimer = null
      if (frame) frame.src = 'about:blank'
      document.body.classList.remove('cases-import-mode')
    }
    if (loaded) { try { frame.contentWindow?.postMessage({ type: 'cases-import-exit' }, '*') } catch {}; closeTimer = setTimeout(finish, 300) } else { finish() }
  }
  window.dispatchEvent(new CustomEvent('xiaodun:cases-import-mode', { detail: { active: next } }))
  reportState(next, source)
}

export function toggleCasesImport(source = 'brain-ui') {
  setCasesImportMode(!active, { source })
}

export function initCasesImport() {
  $('ci-exit-btn')?.addEventListener('click', () => toggleCasesImport())
  // 其他全屏模式抢开时自动让位（事件解耦，避免循环依赖）
  window.addEventListener('xiaodun:hotspot-mode', (e) => { if (e?.detail?.active && active) setCasesImportMode(false, { source: 'hotspot_open' }) })
  window.addEventListener('xiaodun:worldcup-mode', (e) => { if (e?.detail?.active && active) setCasesImportMode(false, { source: 'worldcup_open' }) })
  window.xiaodunCasesImport = { open: () => setCasesImportMode(true), close: () => setCasesImportMode(false), toggle: toggleCasesImport }
}
