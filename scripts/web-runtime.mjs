import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function createReadyFilePath(env = process.env) {
  const configuredPath = String(env.XIAODUN_WEB_READY_FILE || '').trim()
  if (configuredPath) return configuredPath

  return path.join(
    os.tmpdir(),
    'xiaodun-web-' + process.pid + '-' + crypto.randomUUID() + '.ready',
  )
}

export function createWebRuntimeConfig(env = process.env) {
  const port = Number.parseInt(String(env.XIAODUN_PORT || '3721'), 10)
  const safePort = Number.isInteger(port) && port > 0 && port < 65536 ? port : 3721
  const listenHost = String(env.XIAODUN_HOST || '127.0.0.1').trim() || '127.0.0.1'

  return {
    port: safePort,
    listenHost,
    browserUrl: 'http://127.0.0.1:' + safePort + '/',
    readyFile: createReadyFilePath(env),
  }
}

export function waitForReadyFile(filePath, { timeoutMs = 30_000, pollMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs
    let timer = null

    const finish = (error = null) => {
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve()
    }

    const check = () => {
      if (fs.existsSync(filePath)) {
        finish()
        return
      }
      if (Date.now() >= deadline) {
        finish(new Error('Web service did not become ready at ' + filePath))
        return
      }
      timer = setTimeout(check, pollMs)
    }

    check()
  })
}

export function removeReadyFile(filePath) {
  if (!filePath) return
  try {
    fs.rmSync(filePath, { force: true })
  } catch {}
}

export function readProjectPackage() {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
}