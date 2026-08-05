import { spawn } from 'node:child_process'
import process from 'node:process'
import { createWebRuntimeConfig, removeReadyFile, waitForReadyFile } from './web-runtime.mjs'
import { createRagRuntimeConfig, startRagService, stopRagService, waitForRagHealth } from './rag-runtime.mjs'

const config = createWebRuntimeConfig(process.env)
const ragConfig = createRagRuntimeConfig(process.env)
removeReadyFile(config.readyFile)

const baseEnv = {
  ...ragConfig.env,
  ...process.env,
  XIAODUN_WEB_ONLY: '1',
  XIAODUN_PORT: String(config.port),
  XIAODUN_HOST: config.listenHost,
  XIAODUN_WEB_READY_FILE: config.readyFile,
  XIAODUN_RAG_BASE_URL: ragConfig.baseUrl,
  RAG_BASE_URL: ragConfig.baseUrl,
}

const ragChild = startRagService(ragConfig)
const ragExited = new Promise((resolve) => {
  ragChild.once('exit', (code, signal) => resolve({ code, signal }))
})

let backendChild = null
let backendExited = Promise.resolve({ code: 0, signal: null })
let browserOpened = false
let settled = false

function startBackend() {
  if (backendChild) return backendChild

  backendChild = spawn(process.execPath, ['src/index.js'], {
    cwd: process.cwd(),
    env: baseEnv,
    stdio: 'inherit',
    windowsHide: false,
  })

  backendExited = new Promise((resolve) => {
    backendChild.once('exit', (code, signal) => resolve({ code, signal }))
  })

  backendChild.once('error', (error) => {
    console.error('[web] Failed to start backend:', error.message)
    stop(1)
  })
  backendChild.once('exit', (code, signal) => {
    if (!settled && (code || signal)) {
      console.error('[web] Backend exited with code ' + code + (signal ? ' (' + signal + ')' : ''))
      stop(code || 1)
    }
  })

  return backendChild
}

function openBrowser(url) {
  if (browserOpened || /^(1|true|yes|on)$/i.test(String(process.env.XIAODUN_NO_OPEN || ''))) return
  browserOpened = true

  if (process.platform === 'win32') {
    spawn('explorer.exe', [url], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } else if (process.platform === 'darwin') {
    spawn('open', [url], { detached: true, stdio: 'ignore' }).unref()
  } else {
    spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref()
  }
}

function stop(code = 0) {
  if (settled) return
  settled = true
  removeReadyFile(config.readyFile)
  stopRagService(ragChild)
  if (backendChild && !backendChild.killed) backendChild.kill()
  process.exitCode = code
}

async function waitForServicesReady() {
  // RAG service is non-blocking: start it optimistically but don't fail if
  // PostgreSQL / pgvector is unavailable. The main app degrades gracefully
  // and retries RAG calls on demand.
  Promise.race([
    waitForRagHealth(ragConfig, ragChild).then(() => {
      console.log('[rag] Local RAG service is ready: ' + ragConfig.healthUrl)
    }),
    ragExited.then(({ code, signal }) => {
      if (code || signal) {
        console.warn(
          '[rag] Local RAG service exited' +
          (code !== undefined && code !== null ? ' (code ' + code + ')' : '') +
          (signal ? ' (' + signal + ')' : '') +
          '. The app will continue without RAG.',
        )
      }
    }),
  ])

  startBackend()

  const backendResult = await Promise.race([
    waitForReadyFile(config.readyFile).then(() => ({ ready: true })),
    backendExited.then(({ code, signal }) => ({ ready: false, code, signal })),
  ])

  if (!backendResult.ready) {
    throw new Error(
      'Backend exited before the web service became ready' +
      (backendResult.code !== undefined && backendResult.code !== null ? ' (code ' + backendResult.code + ')' : '') +
      (backendResult.signal ? ' (' + backendResult.signal + ')' : ''),
    )
  }
}

ragChild.once('error', (error) => {
  console.warn('[rag] Failed to start local RAG service:', error.message, '(app continues without RAG)')
})
ragChild.once('exit', (code, signal) => {
  if (!settled && (code || signal)) {
    console.warn('[rag] Local RAG service exited with code ' + code + (signal ? ' (' + signal + ')' : '') + '. App continues without RAG.')
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop(0)
  })
}

try {
  await waitForServicesReady()
  console.log('[web] Browser page is ready: ' + config.browserUrl)
  openBrowser(config.browserUrl)
} catch (error) {
  console.error('[web] ' + error.message)
  stop(1)
}
