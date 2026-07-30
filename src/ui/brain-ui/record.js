// 记录备案 模式控制：全屏 iframe + body 类 + 状态上报。
// 与 worldcup/cases-import 完全一致：/ 斜杠命令、agent 事件、自然语言关键词三种方式调出。
import { apiUrl } from './api-client.js'
import { setHotspotMode } from './hotspot.js'
import { setWorldcupMode } from './worldcup.js'
import { setCasesImportMode } from './cases-import.js'

const FRAME_SRC = apiUrl('/src/ui/brain-ui/record.html')

const $ = (id) => document.getElementById(id)
let active = false
let closeTimer = null

// 重播入场动画：复用热点同款 hs-glitch-in（见 styles.css 的 .record-boot 规则）
function replayRecordBoot() {
  const panel = document.querySelector('.record-panel')
  if (!panel) return
  panel.classList.remove('record-boot')
  void panel.offsetWidth
  panel.classList.add('record-boot')
}

function reportState(visible, source = 'brain-ui') {
  fetch(apiUrl('/record-panel-state'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ active: !!visible, source }),
  }).catch(() => {})
}

export function setRecordMode(visible, { source = 'brain-ui' } = {}) {
  const next = !!visible
  if (active === next) {
    reportState(next, source)
    return
  }
  active = next
  const frame = $('record-frame')
  if (next) {
    if (closeTimer) { clearTimeout(closeTimer); closeTimer = null }
    // 与其他全屏模式互斥
    setHotspotMode(false, { source: 'record_open' })
    setWorldcupMode(false, { source: 'record_open' })
    setCasesImportMode(false, { source: 'record_open' })
    if (frame) frame.src = FRAME_SRC
    document.body.classList.add('record-mode')
    replayRecordBoot()
  } else {
    document.querySelector('.record-panel')?.classList.remove('record-boot')
    const loaded = !!(frame && frame.src && !frame.src.includes('about:blank'))
    const finish = () => {
      closeTimer = null
      if (frame) frame.src = 'about:blank'
      document.body.classList.remove('record-mode')
    }
    if (loaded) { try { frame.contentWindow?.postMessage({ type: 'record-exit' }, '*') } catch {}; closeTimer = setTimeout(finish, 300) } else { finish() }
  }
  window.dispatchEvent(new CustomEvent('xiaodun:record-mode', { detail: { active: next } }))
  reportState(next, source)
}

export function toggleRecord(source = 'brain-ui') {
  setRecordMode(!active, { source })
}

export function initRecord() {
  $('rec-exit-btn')?.addEventListener('click', () => toggleRecord())
  // 其他全屏模式抢开时自动让位（事件解耦，避免循环依赖）
  window.addEventListener('xiaodun:hotspot-mode', (e) => { if (e?.detail?.active && active) setRecordMode(false, { source: 'hotspot_open' }) })
  window.addEventListener('xiaodun:worldcup-mode', (e) => { if (e?.detail?.active && active) setRecordMode(false, { source: 'worldcup_open' }) })
  window.addEventListener('xiaodun:cases-import-mode', (e) => { if (e?.detail?.active && active) setRecordMode(false, { source: 'cases_import_open' }) })
  window.xiaodunRecords = { open: () => setRecordMode(true), close: () => setRecordMode(false), toggle: toggleRecord }
}
