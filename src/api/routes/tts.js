// TTS 设置 + 合成路由
import { jsonResponse } from '../utils.js'
import { listTtsProviders, createTtsProvider } from '../../voice/tts/index.js'
import { getTtsConfig, setTtsConfig } from '../../config.js'

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
      const updated = setTtsConfig({
        provider: body.provider,
        apiKey: body.apiKey,
        voiceId: body.voiceId,
        speed: body.speed,
        baseURL: body.baseURL,
        model: body.model,
      })
      jsonResponse(res, 200, { ok: true, tts: updated })
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
