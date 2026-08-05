import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ragRoot = path.join(projectRoot, 'rag-service', 'ai-engine')

function boundedInteger(value, fallback, min, max) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

function loadDotEnv(filePath = path.join(projectRoot, '.env')) {
  try {
    if (!fs.existsSync(filePath)) return {}
    const parsed = parseEnv(fs.readFileSync(filePath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

export function createRagRuntimeConfig(env = process.env) {
  const rawPort = env.XIAODUN_RAG_PORT || env.RAG_PORT || '8001'
  const port = boundedInteger(rawPort, 8001, 1, 65535)
  const host = String(env.XIAODUN_RAG_HOST || env.RAG_HOST || '127.0.0.1').trim() || '127.0.0.1'
  const baseUrl = `http://${host}:${port}`

  return {
    projectRoot,
    ragRoot,
    pythonCommand: String(env.XIAODUN_PYTHON || env.PYTHON || 'python').trim() || 'python',
    host,
    port,
    baseUrl,
    healthUrl: `${baseUrl}/internal/v1/ai/health`,
    startupTimeoutMs: boundedInteger(env.XIAODUN_RAG_STARTUP_TIMEOUT_MS, 180_000, 10_000, 600_000),
    pollMs: boundedInteger(env.XIAODUN_RAG_STARTUP_POLL_MS, 1000, 200, 10_000),
    env: {
      ...loadDotEnv(),
      ...env,
    },
  }
}

export function startRagService(config = createRagRuntimeConfig()) {
  const childEnv = {
    ...config.env,
    PYTHONUNBUFFERED: '1',
    DATABASE_URL: config.env.DATABASE_URL || 'postgresql://xiaodun:xiaodun_dev_only@127.0.0.1:5432/xiaodun',
    EMBEDDING_PROVIDER: config.env.EMBEDDING_PROVIDER || 'local',
    EMBEDDING_MODEL_ID: config.env.EMBEDDING_MODEL_ID || 'BAAI/bge-small-zh-v1.5',
    KNOWLEDGE_BASE_VERSION: config.env.KNOWLEDGE_BASE_VERSION || 'kb_chifraud_competition_v1',
    LOCAL_EMBEDDING_MODEL: config.env.LOCAL_EMBEDDING_MODEL || 'BAAI/bge-small-zh-v1.5',
    EMBEDDING_DEVICE: config.env.EMBEDDING_DEVICE || 'cpu',
    MODEL_SERVICE_BASE_URL: config.env.MODEL_SERVICE_BASE_URL || 'http://model-service:8002',
  }

  return spawn(
    config.pythonCommand,
    ['-m', 'uvicorn', 'rag.api:app', '--app-dir', 'src', '--host', config.host, '--port', String(config.port)],
    {
      cwd: config.ragRoot,
      env: childEnv,
      stdio: 'inherit',
      windowsHide: true,
    },
  )
}

export async function waitForRagHealth(config = createRagRuntimeConfig(), child = null) {
  const deadline = Date.now() + config.startupTimeoutMs
  const fetchImpl = globalThis.fetch

  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch is unavailable in this Node runtime')
  }

  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) {
      throw new Error(`RAG service exited before becoming ready${child.exitCode ? ` (code ${child.exitCode})` : ''}`)
    }

    try {
      const response = await fetchImpl(config.healthUrl, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      const envelope = await response.json().catch(() => null)
      if (response.ok && envelope?.code === 0 && envelope?.data?.status === 'ok') {
        return true
      }
    } catch {
      // Keep polling until timeout or child exit.
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollMs))
  }

  throw new Error(`RAG service did not become ready at ${config.healthUrl}`)
}

export function stopRagService(child, signal = 'SIGTERM') {
  if (!child || child.killed) return
  child.kill(signal)
}
