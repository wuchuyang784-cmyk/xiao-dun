import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const brainUiRoot = path.join(root, 'src', 'ui', 'brain-ui')

function contentTypeFor(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8'
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.json': return 'application/json; charset=utf-8'
    default: return 'text/plain; charset=utf-8'
  }
}

function sendJson(res, body) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function isPathInside(parentDir, candidatePath) {
  const parent = path.resolve(parentDir)
  const candidate = path.resolve(candidatePath)
  const relative = path.relative(parent, candidate)
  return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative))
}

function sendFile(res, filePath) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) throw new Error('not a file')
    res.writeHead(200, {
      'Content-Type': contentTypeFor(filePath),
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath).pipe(res)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

function createServer() {
  const sseClients = new Set()
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')

    if (url.pathname === '/brain-ui' || url.pathname === '/brain-ui.html' || url.pathname === '/') {
      sendFile(res, path.join(root, 'brain-ui.html'))
      return
    }

    if (url.pathname === '/vendor/echarts.min.js') {
      sendFile(res, path.join(root, 'node_modules', 'echarts', 'dist', 'echarts.min.js'))
      return
    }

    if (url.pathname === '/maps/china-provinces.json') {
      sendFile(res, path.join(root, 'public', 'maps', 'china-provinces.json'))
      return
    }

    if (url.pathname === '/api/v1/fraud-statistics/provinces') {
      sendJson(res, {
        ok: true,
        data: {
          generatedAt: new Date().toISOString(),
          intervalHours: 1,
          provinces: [
            { provinceCode: 'BJ', provinceName: '\u5317\u4eac\u5e02', caseCount: 2, highRiskCount: 1, pendingCount: 0, totalLossAmount: 12000 },
            { provinceCode: 'GD', provinceName: '\u5e7f\u4e1c\u7701', caseCount: 1, highRiskCount: 0, pendingCount: 0, totalLossAmount: 3500 },
          ],
        },
      })
      return
    }

    if (url.pathname === '/api/v1/fraud-cases') {
      sendJson(res, {
        ok: true,
        data: {
          cases: [
            {
              caseId: 'smoke-case-1',
              provinceCode: 'BJ',
              provinceName: '\u5317\u4eac\u5e02',
              fraudType: '\u5192\u5145\u5ba2\u670d\u8bc8\u9a97',
              riskLevel: 'high',
              lossAmount: 12000,
              latitude: 39.9042,
              longitude: 116.4074,
              occurredAt: new Date().toISOString(),
            },
          ],
        },
      })
      return
    }

    if (url.pathname.startsWith('/src/ui/brain-ui/')) {
      const relativePath = decodeURIComponent(url.pathname.slice('/src/ui/brain-ui/'.length))
      const assetPath = path.resolve(brainUiRoot, relativePath)
      if (!isPathInside(brainUiRoot, assetPath)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      sendFile(res, assetPath)
      return
    }

    if (url.pathname.startsWith('/src/')) {
      const relativePath = decodeURIComponent(url.pathname.slice('/src/'.length))
      const assetPath = path.resolve(root, 'src', relativePath)
      if (!isPathInside(path.join(root, 'src'), assetPath)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      sendFile(res, assetPath)
      return
    }

    if (url.pathname === '/agent-profile') {
      sendJson(res, { name: 'SmokeXiaoDun' })
      return
    }

    if (url.pathname === '/memories') {
      sendJson(res, [
        { id: 1, mem_id: 'm1', type: 'fact', content: 'Alpha memory', detail: 'First smoke node', created_at: new Date().toISOString() },
        { id: 2, mem_id: 'm2', type: 'preference', content: 'Beta memory', detail: 'Second smoke node', created_at: new Date().toISOString() },
      ])
      return
    }

    if (url.pathname === '/conversations') {
      sendJson(res, [])
      return
    }

    if (url.pathname === '/audit/stats') {
      sendJson(res, {
        windowHours: Number(url.searchParams.get('hours') || 1),
        sinceIso: new Date().toISOString(),
        recall: {},
        extract: {},
      })
      return
    }

    if (url.pathname === '/docs') {
      sendJson(res, { ok: true, topics: [] })
      return
    }

    if (url.pathname.startsWith('/docs/')) {
      sendJson(res, { ok: true, doc: { id: url.pathname.slice(6), title: 'Smoke Doc', body: '' } })
      return
    }


    if (url.pathname === '/settings') {
      sendJson(res, {
        llm: { activated: true, provider: 'deepseek', model: 'smoke', models: [{ id: 'smoke', label: 'Smoke' }] },
        providers: { deepseek: { models: [{ id: 'smoke', label: 'Smoke' }] } },
        minimax: { configured: false },
      })
      return
    }

    if (['/hotspot-state', '/worldcup-state'].includes(url.pathname)) {
      sendJson(res, { ok: true, state: { active: req.method === 'POST', source: 'smoke' } })
      return
    }

    if (url.pathname === '/hotspots') {
      sendJson(res, {
        ok: true,
        refreshMinutes: 30,
        fetchedAt: new Date().toISOString(),
        stale: false,
        platforms: {
          douyin: [
            { rank: 1, title: 'Smoke 热点一', heat: '100万', trend: 'same', isNew: false, source: 'smoke' },
            { rank: 2, title: 'Smoke 热点二', heat: '80万', trend: 'same', isNew: true, source: 'smoke' },
          ],
        },
      })
      return
    }


    if (url.pathname === '/worldcup') {
      sendJson(res, {
        ok: true,
        fetchedAt: new Date().toISOString(),
        stale: false,
        matches: [],
        standings: [],
        news: [],
      })
      return
    }


    if (url.pathname === '/environment-panel') {
      sendJson(res, {
        ok: true,
        agentName: 'SmokeXiaoDun',
        location: { city: 'Beijing', district: 'Haidian', timezone: 'Asia/Shanghai' },
        weather: { condition: 'Clear', temp: 26, feelsLike: 27, humidity: 50, windKmh: 8, visibility: 10 },
      })
      return
    }

    if (url.pathname === '/social/wechat-clawbot/qr') {
      sendJson(res, { ok: true, qr: null, status: 'unavailable' })
      return
    }

    if (url.pathname === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      res.write(`data: ${JSON.stringify({ type: 'connected', data: {}, ts: new Date().toISOString() })}\n\n`)
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return
    }

    if (url.pathname === '/message') {
      sendJson(res, { ok: true })
      return
    }

    res.writeHead(404)
    res.end('not found')
  })

  server.closeAllSse = () => {
    for (const client of sseClients) {
      try { client.end() } catch {}
    }
    sseClients.clear()
  }
  server.emitSse = (event) => {
    for (const client of sseClients) {
      try { client.write(`data: ${JSON.stringify(event)}\n\n`) } catch {}
    }
  }
  return server
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    server.on('error', reject)
  })
}

const server = createServer()
const port = await listen(server)
const baseUrl = `http://127.0.0.1:${port}`
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 840 } })
await page.route('**/worldcup*', async (route) => {
  const requestUrl = new URL(route.request().url())
  if (requestUrl.pathname !== '/worldcup' || requestUrl.searchParams.get('viewed') !== '1') {
    await route.continue()
    return
  }
  await route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({
      ok: true,
      fetchedAt: new Date().toISOString(),
      stale: false,
      matches: [{ id: 'smoke-match-1', status: 'scheduled', startMs: Date.now() + 3600000, home: { name: 'Smoke A' }, away: { name: 'Smoke B' } }],
      standings: [],
      news: [],
    }),
  })
})
await page.addInitScript(() => {
  const NativeWebSocket = window.WebSocket
  class SceneMockWebSocket {
    static CONNECTING = 0
    static OPEN = 1
    static CLOSING = 2
    static CLOSED = 3

    constructor(url) {
      this.url = String(url)
      this.readyState = SceneMockWebSocket.CONNECTING
      this.listeners = new Map()
      queueMicrotask(() => {
        this.readyState = SceneMockWebSocket.OPEN
        this.dispatch({ type: 'open' })
      })
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || new Set()
      listeners.add(listener)
      this.listeners.set(type, listeners)
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener)
    }

    dispatch(event) {
      for (const listener of this.listeners.get(event.type) || []) listener(event)
      this['on' + event.type]?.(event)
    }

    send(payload) {
      try {
        const message = JSON.parse(payload)
        if (message.type === 'hello') {
          queueMicrotask(() => this.dispatch({ type: 'message', data: JSON.stringify({ v: 1, type: 'welcome', rev: 0 }) }))
          queueMicrotask(() => this.dispatch({ type: 'message', data: JSON.stringify({ v: 1, type: 'scene', rev: 0, surfaces: [] }) }))
        }
      } catch {}
    }

    close() {
      if (this.readyState === SceneMockWebSocket.CLOSED) return
      this.readyState = SceneMockWebSocket.CLOSED
      this.dispatch({ type: 'close' })
    }
  }

  function WebSocketShim(url, protocols) {
    if (String(url).endsWith('/scene')) return new SceneMockWebSocket(url)
    return new NativeWebSocket(url, protocols)
  }
  WebSocketShim.CONNECTING = NativeWebSocket.CONNECTING
  WebSocketShim.OPEN = NativeWebSocket.OPEN
  WebSocketShim.CLOSING = NativeWebSocket.CLOSING
  WebSocketShim.CLOSED = NativeWebSocket.CLOSED
  WebSocketShim.prototype = NativeWebSocket.prototype
  window.WebSocket = WebSocketShim
})
const errors = []
page.on('pageerror', error => errors.push(error.stack || error.message))
page.on('console', message => {
  if (message.type() === 'error' || message.text().startsWith('[SSE] failed to handle event')) {
    errors.push(`${message.type()}: ${message.text()}`)
  }
})
page.on('response', response => {
  if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
})

try {
  await page.goto(`${baseUrl}/brain-ui`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#map-stage', { state: 'attached', timeout: 5000 })
  const snapshot = await page.evaluate(() => ({
    mapStage: Boolean(document.querySelector('#map-stage')),
    graph: Boolean(document.querySelector('#graph')),
    cameraControls: Boolean(document.querySelector('.camera-status, .camera-close-btn')),
    personCard: Boolean(document.querySelector('.person-card-panel')),
    removedModes: document.body.classList.contains('music-mode') || document.body.classList.contains('aivideo-mode'),
    brand: document.querySelector('#agent-brand-name')?.textContent || '',
  }))
  if (!snapshot.mapStage) throw new Error('China map stage is missing')
  if (snapshot.graph) throw new Error('memory graph markup remains')
  if (snapshot.cameraControls) throw new Error('camera controls remain')
  if (snapshot.personCard) throw new Error('person card markup remains')
  if (snapshot.removedModes) throw new Error('removed media mode is active')

  // Regression check: a complete assistant answer must appear without a page refresh.
  // Exercise both the live stream bubble and the authoritative message event.
  const liveReply = 'SSE 实时回答测试'
  await page.waitForTimeout(100)
  server.emitSse({ type: 'message_received', data: { input: '[ID:000001] smoke message' } })
  server.emitSse({ type: 'stream_start', data: { mode: 'text', plainReply: true } })
  server.emitSse({ type: 'stream_chunk', data: { mode: 'text', text: liveReply } })
  await page.waitForFunction((text) => {
    const live = document.querySelector('#chat-messages .msg-live')
    return Boolean(live && live.innerText.includes(text))
  }, liveReply, { timeout: 5000 })
  server.emitSse({
    type: 'message',
    data: { from: 'consciousness', content: liveReply, conversation_id: 'smoke-sse-1', channel: 'TUI' },
  })
  await page.waitForFunction((text) => {
    const messages = [...document.querySelectorAll('#chat-messages .msg-jarvis')]
    return messages.some((message) => message.innerText.includes(text) && !message.classList.contains('msg-live'))
  }, liveReply, { timeout: 5000 })

  const panelCases = [
    { name: 'hotspot', command: '\u6253\u5f00\u5b9e\u65f6\u70ed\u70b9', mode: 'hotspot-mode', panelId: 'hotspot-panel' },
    { name: 'worldcup', command: '\u6253\u5f00\u4e16\u754c\u676f\u9762\u677f', mode: 'worldcup-mode', panelId: 'worldcup-panel' },
  ]
  snapshot.panels = {}
  for (const panelCase of panelCases) {
    await page.fill('#msg-input', panelCase.command)
    await page.click('#send-btn')
    await page.waitForFunction(mode => document.body.classList.contains(mode), panelCase.mode)
    await page.waitForFunction(({ panelId }) => {
      const panel = document.getElementById(panelId)
      if (!panel || panel.parentElement !== document.body) return false
      const rect = panel.getBoundingClientRect()
      const style = getComputedStyle(panel)
      return rect.width >= 320
        && rect.height >= 240
        && Number.parseFloat(style.opacity || '0') >= 0.9
        && style.pointerEvents !== 'none'
    }, panelCase, { timeout: 5000 }).catch(() => {})
    const panelState = await page.evaluate(({ panelId }) => {
      const panel = document.getElementById(panelId)
      const rect = panel?.getBoundingClientRect()
      const style = panel ? getComputedStyle(panel) : null
      return {
        exists: Boolean(panel),
        directBodyChild: panel?.parentElement === document.body,
        width: rect?.width || 0,
        height: rect?.height || 0,
        opacity: style?.opacity || '',
        pointerEvents: style?.pointerEvents || '',
      }
    }, panelCase)
    snapshot.panels[panelCase.name] = panelState
    if (!panelState.exists || !panelState.directBodyChild || panelState.width < 320 || panelState.height < 240 || panelState.opacity === '0' || panelState.pointerEvents === 'none') {
      throw new Error(`${panelCase.name} panel is active but not visibly mounted: ${JSON.stringify(panelState)}`)
    }
  }
  if (errors.length) throw new Error(`browser errors:\n${errors.join('\n')}`)
  console.log('[PASS] brain-ui smoke')
  console.log(JSON.stringify(snapshot, null, 2))
} finally {
  await browser.close()
  server.closeAllSse()
  await new Promise(resolve => server.close(resolve))
}
