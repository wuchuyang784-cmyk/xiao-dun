import { spawn } from 'node:child_process'
import process from 'node:process'
import { createWebRuntimeConfig, removeReadyFile, waitForReadyFile } from './web-runtime.mjs'

const config = createWebRuntimeConfig(process.env)
removeReadyFile(config.readyFile)

const childEnv = {
  ...process.env,
  XIAODUN_WEB_ONLY: '1',
  XIAODUN_PORT: String(config.port),
  XIAODUN_HOST: config.listenHost,
  XIAODUN_WEB_READY_FILE: config.readyFile,
}

const child = spawn(process.execPath, ['--env-file-if-exists=.env', 'src/index.js'], {
  cwd: process.cwd(),
  env: childEnv,
  stdio: 'inherit',
  windowsHide: false,
})

const childExited = new Promise((resolve) => {
  child.once('exit', (code, signal) => resolve({ code, signal }))
})

let browserOpened = false
let settled = false

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

async function waitForBackendReady() {
  const result = await Promise.race([
    waitForReadyFile(config.readyFile).then(() => ({ ready: true })),
    childExited.then(({ code, signal }) => ({ ready: false, code, signal })),
  ])

  if (!result.ready) {
    throw new Error(
      'Backend exited before the web service became ready' +
      (result.code !== undefined && result.code !== null ? ' (code ' + result.code + ')' : '') +
      (result.signal ? ' (' + result.signal + ')' : ''),
    )
  }
}

function stop(code = 0) {
  if (settled) return
  settled = true
  removeReadyFile(config.readyFile)
  if (!child.killed) child.kill()
  process.exitCode = code
}

child.once('error', (error) => {
  console.error('[web] Failed to start backend:', error.message)
  stop(1)
})
child.once('exit', (code, signal) => {
  if (!settled && code && code !== 0) {
    console.error('[web] Backend exited with code ' + code + (signal ? ' (' + signal + ')' : ''))
  }
  stop(code || 0)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    if (!child.killed) child.kill(signal)
    stop(0)
  })
}

try {
  await waitForBackendReady()
  console.log('[web] Browser page is ready: ' + config.browserUrl)
  openBrowser(config.browserUrl)
} catch (error) {
  console.error('[web] ' + error.message)
  stop(1)
}