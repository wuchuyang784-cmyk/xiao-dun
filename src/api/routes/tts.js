// TTS 设置 + 合成路由
import { jsonResponse } from '../utils.js'
import { listTtsProviders, createTtsProvider, getTtsConfig } from '../../voice/tts/index.js'
import { readExistingStoredConfig, writeStoredConfig } from '../../config.js'

async function readJsonBody(req) {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}) } catch { resolve({}) } })
    req.on('error', () => resolve({}))
  })
}

export async function handleTtsRoutes(req, res, url) {
  // GET /settings/tts — 获取当前 TTS 配置
  if (req.method === 'GET' && url.pathname === '/settings/tts') {
    const cfg = getTtsConfig()
    jsonResponse(res, 200, { ok: true, tts: cfg })
    return true
  }

  // POST /settings/tts — 保存 TTS 配置
  if (req.method === 'POST' && url.pathname === '/settings/tts') {
    try {
      const body = await readJsonBody(req)
      const existing = readExistingStoredConfig()
      const tts = { ...(existing.tts || {}) }

      if (body.provider !== undefined) tts.ttsProvider = body.provider
      if (body.apiKey !== undefined) {
        // 根据当前 provider 存到对应 key
        const provider = body.provider || tts.ttsProvider || 'doubao'
        if (provider === 'doubao') tts.doubaoKey = body.apiKey
        else if (provider === 'openai') tts.openaiTtsKey = body.apiKey
        else tts.doubaoKey = body.apiKey
      }
      if (body.voiceId !== undefined) tts.ttsVoiceId = body.voiceId
      if (body.model !== undefined) tts.ttsModel = body.model
      if (body.baseURL !== undefined) tts.openaiTtsBaseURL = body.baseURL

      writeStoredConfig({ ...existing, tts })
      jsonResponse(res, 200, { ok: true, tts: getTtsConfig() })
    } catch (err) {
      jsonResponse(res, 400, { ok: false, error: err.message })
    }
    return true
  }

  // GET /tts/voices — 列出当前 provider 的音色
  if (req.method === 'GET' && url.pathname === '/tts/voices') {
    try {
      const provider = url.searchParams?.get('provider') || ''
      const providerOpts = provider ? { provider } : {}
      const instance = createTtsProvider(providerOpts)
      const voices = await instance.listVoices()
      jsonResponse(res, 200, { ok: true, voices })
    } catch (err) {
      jsonResponse(res, 503, { ok: false, error: `服务异常：${err.message}` })
    }
    return true
  }

  // POST /tts/synthesize — 合成音频
  if (req.method === 'POST' && url.pathname === '/tts/synthesize') {
    try {
      const body = await readJsonBody(req)
      if (!body || !body.text) {
        jsonResponse(res, 400, { ok: false, error: 'text 参数为空' })
        return true
      }

      const provider = createTtsProvider({ voiceId: body.voiceId })
      const audioBuf = await provider.synthesize(body.text, {
        voiceId: body.voiceId,
        speed: Number(body.speed) || 1.0,
        format: body.format || 'mp3',
      })

      res.writeHead(200, {
        'Content-Type': body.format === 'wav' ? 'audio/wav' : 'audio/mpeg',
        'Content-Length': audioBuf.length,
        'Cache-Control': 'public, max-age=3600',
      })
      res.end(audioBuf)
    } catch (err) {
      const status = err.code === 'TTS_NO_KEY' ? 401
        : err.code === 'TTS_EMPTY_TEXT' ? 400
        : 503
      jsonResponse(res, status, { ok: false, error: `服务异常：${err.message}` })
    }
    return true
  }

  // GET /tts/providers
  if (req.method === 'GET' && url.pathname === '/tts/providers') {
    jsonResponse(res, 200, { ok: true, providers: listTtsProviders() })
    return true
  }

  return false
}
