import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { paths } from '../../paths.js'
import { config } from '../../config.js'
import {
  apiCapabilityNeedsCredential,
  buildApiSlotContext,
  configureApiCapabilitySlot,
  deleteApiCapabilitySlot,
  getApiCapabilityCredential,
  findConfiguredApiSlotByKind,
  getApiCapabilitySlot,
  listApiCapabilitySlots,
  normalizeApiCapabilityKind,
  setApiCapabilitySlotEnabled,
} from '../api-slots.js'

const IMAGE_EXT_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}

const GENERIC_SECRET_RE = /\b(?:sk|ak|rk|pk|ark)-[A-Za-z0-9_\-.]{12,180}\b/g

function toolJson(payload) {
  return JSON.stringify(payload, null, 2)
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function redactSlotSecrets(value, slot = {}, secretValue = '') {
  const secret = String(secretValue || '').trim()
  if (typeof value === 'string') {
    const exactRedacted = secret
      ? value.replace(new RegExp(escapeRegExp(secret), 'g'), '[redacted]')
      : value
    return exactRedacted.replace(GENERIC_SECRET_RE, '[redacted]')
  }
  if (Array.isArray(value)) return value.map(item => redactSlotSecrets(item, slot, secretValue))
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, item] of Object.entries(value)) {
    out[key] = /^(?:api[_-]?key|apikey|access[_-]?key|secret|token|password|authorization|bearer)$/i.test(key) && typeof item === 'string'
      ? '[redacted]'
      : redactSlotSecrets(item, slot, secretValue)
  }
  return out
}

function firstMarkdownImage(text = '') {
  const match = String(text || '').match(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/)
  return match?.[1] || ''
}

function findImageReference(args = {}, context = {}) {
  return String(args.image_url || args.imageUrl || args.url || '').trim()
    || String(args.image_path || args.imagePath || args.path || '').trim()
    || firstMarkdownImage(args.markdown || args.content || args.text || '')
    || firstMarkdownImage(context.currentUserMessage || '')
    || firstMarkdownImage(
      [...(context.conversationWindow || [])]
        .reverse()
        .map(row => row?.content || '')
        .join('\n'),
    )
}

function mimeFromPath(filePath = '') {
  return IMAGE_EXT_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
}

function resolveMediaChatPath(urlPath = '') {
  const raw = String(urlPath || '').trim()
  if (!raw.startsWith('/media/chat/')) return ''
  const filename = path.basename(decodeURIComponent(raw.slice('/media/chat/'.length)))
  return path.join(paths.mediaDir, filename)
}

function resolveLocalImagePath(ref = '') {
  let raw = String(ref || '').trim()
  if (!raw) return ''
  if (/^file:\/\//i.test(raw)) {
    try { raw = fileURLToPath(raw) } catch { return '' }
  }
  if (raw.startsWith('/media/chat/')) return resolveMediaChatPath(raw)
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return ''
  return path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(paths.sandboxDir, raw)
}

function localImageToDataUrl(filePath = '') {
  const resolved = path.resolve(filePath)
  const stat = fs.statSync(resolved)
  if (!stat.isFile()) throw new Error(`image path is not a file: ${resolved}`)
  if (stat.size > 20 * 1024 * 1024) throw new Error('image file is larger than 20MB')
  const mime = mimeFromPath(resolved)
  if (!mime.startsWith('image/')) throw new Error(`unsupported image extension: ${path.extname(resolved)}`)
  const bytes = fs.readFileSync(resolved)
  return `data:${mime};base64,${bytes.toString('base64')}`
}

function resolveImageUrl(ref = '') {
  const raw = String(ref || '').trim()
  if (!raw) throw new Error('image reference required')
  if (/^data:image\//i.test(raw)) return raw
  if (/^https?:\/\//i.test(raw)) return raw
  const localPath = resolveLocalImagePath(raw)
  if (!localPath) throw new Error('image must be an http(s), data:image, /media/chat, file://, or local file path')
  if (!fs.existsSync(localPath)) throw new Error(`image file not found: ${localPath}`)
  return localImageToDataUrl(localPath)
}

function isPathInside(parentDir, candidatePath) {
  const rel = path.relative(path.resolve(parentDir), path.resolve(candidatePath))
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel))
}

function resolveCapabilityProgramPath(programPath = '') {
  const raw = String(programPath || '').trim()
  if (!raw) throw new Error('capability program_path is not configured')
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new Error('program_path must be a local file path')
  const resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(paths.sandboxApiCapabilitiesDir, raw)
  if (!isPathInside(paths.sandboxApiCapabilitiesDir, resolved)) {
    throw new Error(`program_path must be inside sandbox/api-capabilities: ${resolved}`)
  }
  if (!fs.existsSync(resolved)) throw new Error(`program_path not found: ${resolved}`)
  const stat = fs.statSync(resolved)
  if (!stat.isFile()) throw new Error(`program_path is not a file: ${resolved}`)
  return resolved
}

function buildProgramCommand(slot, programPath) {
  const runtime = String(slot?.program?.runtime || '').trim().toLowerCase()
  if (runtime === 'node' || runtime === 'nodejs' || !runtime) {
    return { file: process.execPath, args: [programPath] }
  }
  if (runtime === 'python' || runtime === 'python3') {
    return { file: 'python', args: [programPath] }
  }
  throw new Error(`unsupported capability program runtime: ${runtime}`)
}

function publicRuntimeSlot(slot = {}) {
  return {
    id: slot.id,
    kind: slot.kind,
    provider: slot.provider,
    label: slot.label,
    summary: slot.summary,
    api: {
      protocol: slot.api?.protocol || '',
      baseURL: slot.api?.baseURL || '',
      endpoint: slot.api?.endpoint || '',
      model: slot.api?.model || '',
      configured: !!slot.api?.configured,
    },
    docs: {
      url: slot.docs?.url || '',
      summary: slot.docs?.summary || '',
    },
    inputSchema: slot.inputSchema || {},
    outputSchema: slot.outputSchema || {},
  }
}

function runCapabilityProgram(slot, args = {}, context = {}, { apiKey = '' } = {}) {
  const programPath = resolveCapabilityProgramPath(slot.program?.path)
  const command = buildProgramCommand(slot, programPath)
  const payload = {
    args,
    slot: publicRuntimeSlot(slot),
    credentials: {
      apiKeyEnv: slot.api?.credentialRequired ? 'CAPABILITY_API_KEY' : '',
    },
  }
  const input = JSON.stringify(payload)
  const timeoutMs = Math.min(Math.max(Number(slot.program?.timeoutMs) || 60_000, 1_000), 10 * 60_000)

  return new Promise((resolve, reject) => {
    const child = spawn(command.file, command.args, {
      cwd: path.dirname(programPath),
      windowsHide: true,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        CAPABILITY_SLOT_ID: slot.id,
        CAPABILITY_PROVIDER: slot.provider,
        CAPABILITY_KIND: slot.kind,
        CAPABILITY_API_KEY: apiKey,
        CAPABILITY_BASE_URL: slot.api?.baseURL || '',
        CAPABILITY_ENDPOINT: slot.api?.endpoint || '',
        CAPABILITY_MODEL: slot.api?.model || '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout = []
    const stderr = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill() } catch {}
      reject(new Error(`capability program timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }

    if (context.signal) {
      if (context.signal.aborted) {
        try { child.kill() } catch {}
        finish(reject, new Error('aborted'))
        return
      }
      context.signal.addEventListener('abort', () => {
        try { child.kill() } catch {}
        finish(reject, new Error('aborted'))
      }, { once: true })
    }

    child.stdout?.on('data', d => stdout.push(Buffer.from(d)))
    child.stderr?.on('data', d => stderr.push(Buffer.from(d)))
    child.on('error', err => finish(reject, err))
    child.on('close', code => finish(resolve, {
      code,
      stdout: Buffer.concat(stdout).toString('utf-8').trim(),
      stderr: Buffer.concat(stderr).toString('utf-8').trim(),
    }))
    child.stdin.end(input)
  })
}

function parseProgramStdout(stdout = '') {
  const text = String(stdout || '').trim()
  if (!text) return null
  try { return JSON.parse(text) } catch { return text }
}

function argsForCapabilityRun(args = {}) {
  if (args.args && typeof args.args === 'object' && !Array.isArray(args.args)) return args.args
  const {
    slot_id: _slotId,
    slotId: _slotId2,
    kind: _kind,
    args: _args,
    ...rest
  } = args
  return rest
}

function buildChatCompletionUrl(slot) {
  const baseURL = String(slot?.api?.baseURL || '').replace(/\/+$/, '')
  const endpoint = String(slot?.api?.endpoint || '/chat/completions')
  if (!baseURL) throw new Error('slot baseURL missing')
  return endpoint.startsWith('http') ? endpoint : `${baseURL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
}

function visionTemperatureForSlot(slot = {}) {
  const provider = String(slot.provider || '').trim().toLowerCase()
  const model = String(slot.api?.model || '').trim().toLowerCase()
  const baseURL = String(slot.api?.baseURL || '').trim().toLowerCase()
  if (
    provider === 'moonshot'
    || provider === 'kimi'
    || model.startsWith('kimi-')
    || baseURL.includes('moonshot.cn')
    || baseURL.includes('kimi.com')
  ) {
    return 1
  }
  return 0.2
}

function isQwenOmniSlot(slot = {}) {
  const provider = String(slot.provider || '').trim().toLowerCase()
  const model = String(slot.api?.model || '').trim().toLowerCase()
  return provider === 'qwen' && model.includes('omni')
}

function getVisionModelIssue(slot = {}) {
  const provider = String(slot.provider || '').trim().toLowerCase()
  const model = String(slot.api?.model || '').trim().toLowerCase()
  if (provider === 'qwen' && /^qwen3\.7-max(?:-2026-05-20)?$/.test(model)) {
    return {
      error: 'model_not_vision_capable',
      guide: '当前 Qwen 模型是文本模型，不能直接识别图片。请切换到明确支持视觉输入的模型（例如 qwen3.7-max-2026-06-08、qwen3.7-plus 或带 vision/omni 标识的模型），或配置独立视觉能力槽。',
    }
  }
  return null
}

function readVisionContentPart(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value.map(item => readVisionContentPart(item)).join('')
  }
  if (value && typeof value === 'object') {
    return readVisionContentPart(value.text ?? value.content ?? '')
  }
  return ''
}

async function readStreamingVisionResponse(response) {
  if (!response.body?.getReader) {
    throw new Error('vision streaming response body is unavailable')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let streamDone = false

  const consumeLine = (line) => {
    const trimmed = line.trim()
    if (!trimmed || !trimmed.startsWith('data:')) return
    const payload = trimmed.slice('data:'.length).trim()
    if (payload === '[DONE]') {
      streamDone = true
      return
    }
    try {
      const data = JSON.parse(payload)
      const delta = data?.choices?.[0]?.delta?.content
        ?? data?.choices?.[0]?.message?.content
        ?? data?.output_text
        ?? ''
      content += readVisionContentPart(delta)
    } catch {
      // Ignore non-JSON SSE keepalive/comment frames.
    }
  }

  while (!streamDone) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) consumeLine(line)
    if (done) break
  }
  if (buffer) consumeLine(buffer)
  return content
}

function getActiveLlmVisionFallback() {
  const apiKey = String(config.apiKey || '').trim()
  const model = String(config.model || '').trim()
  const baseURL = String(config.baseURL || '').trim()
  if (config.needsActivation || !apiKey || !model || !baseURL) return null

  const provider = String(config.provider || 'custom').trim().toLowerCase() || 'custom'
  return {
    apiKey,
    slot: {
      id: 'vision.active-llm',
      kind: 'vision',
      provider,
      label: '\u5f53\u524d\u5bf9\u8bdd\u6a21\u578b\uff08\u89c6\u89c9\u56de\u9000\uff09',
      summary: '\u6ca1\u6709\u72ec\u7acb\u89c6\u89c9\u80fd\u529b\u69fd\u65f6\uff0c\u4e34\u65f6\u590d\u7528\u5f53\u524d\u5df2\u914d\u7f6e\u7684 OpenAI-compatible \u5bf9\u8bdd\u6a21\u578b\u3002',
      enabled: true,
      api: {
        protocol: 'openai-chat-completions',
        baseURL,
        endpoint: '/chat/completions',
        model,
        configured: true,
        credentialRequired: true,
      },
    },
  }
}

function getImplicitVisionFallback() {
  return getActiveLlmVisionFallback()
}

function visionTimeoutMs(context = {}) {
  const raw = Number(context.visionTimeoutMs || process.env.XIAODUN_VISION_TIMEOUT_MS || 20_000)
  return Math.min(Math.max(Number.isFinite(raw) ? raw : 20_000, 1_000), 60_000)
}

function combineAbortSignals(...signals) {
  const activeSignals = signals.filter(Boolean)
  if (!activeSignals.length) return undefined
  if (activeSignals.length === 1) return activeSignals[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(activeSignals)

  const controller = new AbortController()
  const abort = (signal) => {
    if (!controller.signal.aborted) controller.abort(signal?.reason || new DOMException('Aborted', 'AbortError'))
  }
  for (const signal of activeSignals) {
    if (signal.aborted) {
      abort(signal)
      break
    }
    signal.addEventListener('abort', () => abort(signal), { once: true })
  }
  return controller.signal
}

async function callOpenAICompatibleVision(slot, { imageUrl, prompt, detail = 'auto' }, context = {}, credentialOverride = '') {
  const apiKey = String(credentialOverride || getApiCapabilityCredential(slot) || '').trim()
  if (!apiKey) throw new Error('slot credential is not configured')
  const streaming = isQwenOmniSlot(slot)
  const body = {
    model: slot.api.model,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl, detail } },
        ],
      },
    ],
    temperature: visionTemperatureForSlot(slot),
    stream: streaming,
  }
  const res = await fetch(buildChatCompletionUrl(slot), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: combineAbortSignals(context.signal, AbortSignal.timeout(visionTimeoutMs(context))),
  })
  if (!res.ok) {
    const errorText = await res.text()
    let errorData = null
    try { errorData = errorText ? JSON.parse(errorText) : null } catch {}
    const message = errorData?.error?.message || errorData?.message || errorText || `HTTP ${res.status}`
    throw new Error(message.slice(0, 1000))
  }
  if (streaming) {
    const result = await readStreamingVisionResponse(res)
    if (!result) throw new Error('vision API returned no streaming content')
    return result
  }

  const text = await res.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch {}
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('vision API returned no choices[0].message.content')
  return String(content)
}

export async function execAnalyzeImage(args = {}, context = {}) {
  const configuredSlot = findConfiguredApiSlotByKind('vision', args.slot_id || args.slotId)
  const implicitFallback = configuredSlot ? null : getImplicitVisionFallback(context)
  const slot = configuredSlot || implicitFallback?.slot
  if (!slot) {
    return toolJson({
      ok: false,
      tool: 'analyze_image',
      error: 'not_configured',
      guide: 'No available vision analyzer. Configure a vision-capable LLM model, or set the current LLM to one that supports image input.',
    })
  }
  const modelIssue = getVisionModelIssue(slot)
  if (modelIssue) {
    return toolJson({
      ok: false,
      tool: 'analyze_image',
      error: modelIssue.error,
      provider: slot.provider,
      model: slot.api?.model || '',
      guide: modelIssue.guide,
    })
  }

  const slotApiKey = implicitFallback?.apiKey || getApiCapabilityCredential(slot)
  try {
    const imageRef = findImageReference(args, context)
    const imageUrl = resolveImageUrl(imageRef)
    const prompt = String(args.prompt || args.question || '').trim()
      || 'Please describe this image in Chinese. If there is visible text, perform OCR. Answer the user question first when it asks about specific details.'
    const detail = ['low', 'high', 'auto'].includes(args.detail) ? args.detail : 'auto'
    const result = await callOpenAICompatibleVision(slot, { imageUrl, prompt, detail }, context, slotApiKey)
    return toolJson({
      ok: true,
      tool: 'analyze_image',
      slot_id: slot.id,
      provider: slot.provider,
      model: slot.api.model,
      result: redactSlotSecrets(result, slot, slotApiKey),
    })
  } catch (err) {
    return toolJson({
      ok: false,
      tool: 'analyze_image',
      slot_id: slot.id,
      error: redactSlotSecrets(err.message, slot, slotApiKey),
      docs_hint: buildApiSlotContext(slot).slice(0, 1200),
    })
  }
}

export async function execRunApiCapability(args = {}, context = {}) {
  const slotId = String(args.slot_id || args.slotId || '').trim()
  const kind = String(args.kind || '').trim().toLowerCase()
  let slot = slotId ? getApiCapabilitySlot(slotId) : null
  if (!slot && kind) {
    slot = listApiCapabilitySlots()
      .find(s => s.enabled && s.kind === kind && s.program?.path)
  }
  if (!slot) {
    return toolJson({
      ok: false,
      tool: 'run_api_capability',
      error: 'slot_not_found',
      guide: 'No matching API capability slot is configured. Configure one first with manage_api_capability(action="configure") after reading the user intent and API docs.',
    })
  }
  if (slot.enabled === false) {
    return toolJson({ ok: false, tool: 'run_api_capability', slot_id: slot.id, error: 'slot_disabled' })
  }
  if (!slot.program?.path) {
    return toolJson({
      ok: false,
      tool: 'run_api_capability',
      slot_id: slot.id,
      error: 'program_not_configured',
      guide: 'The slot exists, but no tested program_path is registered. Write and test the capability runner, then configure the slot with program_path.',
    })
  }

  const credentialRequired = apiCapabilityNeedsCredential(slot)
  const slotApiKey = credentialRequired ? getApiCapabilityCredential(slot) : ''
  if (credentialRequired && !slotApiKey) {
    return toolJson({
      ok: false,
      tool: 'run_api_capability',
      slot_id: slot.id,
      error: 'credential_not_configured',
      guide: 'The slot metadata exists, but its credential is missing. Reconfigure the slot with manage_api_capability(action="configure") and the API key.',
    })
  }

  try {
    const run = await runCapabilityProgram(slot, argsForCapabilityRun(args), context, { apiKey: slotApiKey })
    const parsed = parseProgramStdout(run.stdout)
    const ok = run.code === 0 && !(parsed && typeof parsed === 'object' && parsed.ok === false)
    return toolJson({
      ok,
      tool: 'run_api_capability',
      slot_id: slot.id,
      provider: slot.provider,
      kind: slot.kind,
      exit_code: run.code,
      result: redactSlotSecrets(parsed, slot, slotApiKey),
      ...(run.stderr ? { stderr: redactSlotSecrets(run.stderr.slice(0, 2000), slot, slotApiKey) } : {}),
    })
  } catch (err) {
    return toolJson({
      ok: false,
      tool: 'run_api_capability',
      slot_id: slot.id,
      error: redactSlotSecrets(err.message, slot, slotApiKey),
      docs_url: slot.docs?.url || '',
      guide: 'Use the docs_url and the registered program_path to debug the capability runner; update the runner and retest before using it again.',
    })
  }
}

export function execManageApiCapability(args = {}) {
  const action = String(args.action || 'list').trim().toLowerCase()
  try {
    if (action === 'list') {
      return toolJson({ ok: true, tool: 'manage_api_capability', slots: listApiCapabilitySlots() })
    }

    if (action === 'save_doc') {
      const provider = String(args.provider || '').trim().toLowerCase()
      const kind = normalizeApiCapabilityKind(args.kind || 'vision')
      const slot = configureApiCapabilitySlot({
        slotId: args.slot_id || args.slotId || '',
        provider,
        kind,
        docsText: args.docs || args.config_docs || args.configDocs || '',
        docsUrl: args.docs_url || args.docsUrl || '',
        docsSummary: args.docs_summary || args.docsSummary || '',
        docsSource: args.docs_source || args.docsSource || 'user_or_agent_intent',
        executionInstructions: args.execution_instructions || args.executionInstructions || '',
        model: args.model || '',
        baseURL: args.base_url || args.baseURL || '',
        triggers: Array.isArray(args.triggers) ? args.triggers : [],
      })
      return toolJson({
        ok: true,
        tool: 'manage_api_capability',
        action,
        slot,
        next: slot.configured
          ? 'Slot is configured and can be used when its triggers match.'
          : 'Docs saved. When the user provides the API key with intent to configure this capability, call manage_api_capability action="configure".',
      })
    }

    if (action === 'configure') {
      const apiKey = String(args.api_key || args.apiKey || '').trim()
      const provider = String(args.provider || '').trim().toLowerCase()
      const kind = normalizeApiCapabilityKind(args.kind || 'vision')
      const protocol = String(args.protocol || 'openai-chat-completions').trim()
      const authType = String(args.auth_type || args.authType || '').trim().toLowerCase().replace(/-/g, '_')
      const credentialRequired = args.credential_required ?? args.credentialRequired
      const noCredentialRequested = authType === 'none' || credentialRequired === false || protocol === 'local-program'
      if (!apiKey && !noCredentialRequested) {
        return toolJson({
          ok: false,
          tool: 'manage_api_capability',
          error: 'api_key required for configure',
          guide: 'Ask the user to provide the API key they applied for, then call configure with provider/kind/docs_url or docs plus api_key.',
        })
      }
      const slot = configureApiCapabilitySlot({
        slotId: args.slot_id || args.slotId || '',
        provider,
        kind,
        label: args.label || '',
        summary: args.summary || '',
        apiKey,
        authType: noCredentialRequested ? 'none' : (authType || 'api_key'),
        credentialRequired: !noCredentialRequested,
        docsText: args.docs || args.config_docs || args.configDocs || '',
        docsUrl: args.docs_url || args.docsUrl || '',
        docsSummary: args.docs_summary || args.docsSummary || '',
        docsSource: args.docs_source || args.docsSource || 'user_or_agent_intent',
        executionInstructions: args.execution_instructions || args.executionInstructions || '',
        model: args.model || '',
        baseURL: args.base_url || args.baseURL || '',
        endpoint: args.endpoint || '',
        protocol,
        programPath: args.program_path || args.programPath || '',
        programRuntime: args.program_runtime || args.programRuntime || '',
        programTimeoutMs: args.program_timeout_ms || args.programTimeoutMs,
        inputSchema: args.input_schema || args.inputSchema || null,
        outputSchema: args.output_schema || args.outputSchema || null,
        permissions: args.permissions && typeof args.permissions === 'object' ? args.permissions : {},
        testResults: Array.isArray(args.test_results || args.testResults) ? (args.test_results || args.testResults) : [],
        triggers: Array.isArray(args.triggers) ? args.triggers : [],
      })
      return toolJson({
        ok: true,
        tool: 'manage_api_capability',
        action,
        slot,
        note: 'Configured by explicit agent intent. API key is stored in the local credential store and not returned.',
      })
    }

    if (action === 'enable' || action === 'disable') {
      const slotId = args.slot_id || args.slotId || ''
      if (!slotId) {
        return toolJson({
          ok: false,
          tool: 'manage_api_capability',
          action,
          error: 'slot_id required',
        })
      }
      const slot = setApiCapabilitySlotEnabled(slotId, action === 'enable')
      return toolJson({ ok: true, tool: 'manage_api_capability', action, slot })
    }

    if (action === 'delete') {
      const slotId = args.slot_id || args.slotId
      const ok = deleteApiCapabilitySlot(slotId)
      return toolJson({ ok, tool: 'manage_api_capability', action, slot_id: slotId })
    }

    if (action === 'get') {
      const slotId = args.slot_id || args.slotId || ''
      if (!slotId) {
        return toolJson({
          ok: false,
          tool: 'manage_api_capability',
          action,
          error: 'slot_id required',
        })
      }
      const slot = getApiCapabilitySlot(slotId, { includeSecrets: false })
      return toolJson({ ok: !!slot, tool: 'manage_api_capability', action, slot })
    }

    return toolJson({
      ok: false,
      tool: 'manage_api_capability',
      error: 'unsupported action',
      supported_actions: ['list', 'get', 'save_doc', 'configure', 'enable', 'disable', 'delete'],
    })
  } catch (err) {
    return toolJson({ ok: false, tool: 'manage_api_capability', action, error: err.message })
  }
}
