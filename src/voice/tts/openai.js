// OpenAI TTS 兼容 Provider（也支持通义千问、MiniMax 等 OpenAI 兼容接口）
import TtsProvider from './base.js'

const VOICES = [
  { id: 'alloy', label: 'Alloy（中性·英文）', gender: 'neutral' },
  { id: 'echo', label: 'Echo（男声·英文）', gender: 'male' },
  { id: 'fable', label: 'Fable（英式男声）', gender: 'male' },
  { id: 'onyx', label: 'Onyx（低沉男声）', gender: 'male' },
  { id: 'nova', label: 'Nova（女声·英文）', gender: 'female' },
  { id: 'shimmer', label: 'Shimmer（女声·英文）', gender: 'female' },
]

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

export default class OpenAITts extends TtsProvider {
  static get id() { return 'openai' }
  static get label() { return 'OpenAI TTS' }

  constructor(opts = {}) {
    super(opts)
    this.baseURL = opts.baseURL || DEFAULT_BASE_URL
    this.model = opts.model || 'tts-1'
  }

  async listVoices() {
    return VOICES.map(v => ({ ...v, provider: 'openai' }))
  }

  async synthesize(text, opts = {}) {
    const voiceId = opts.voiceId || this.voiceId || VOICES[0].id
    const speed = opts.speed || 1.0
    const model = opts.model || this.model

    if (!this.apiKey) {
      const err = new Error('OpenAI TTS 未配置 API Key')
      err.code = 'TTS_NO_KEY'
      throw err
    }
    if (!text || !text.trim()) {
      const err = new Error('TTS 合成文本为空')
      err.code = 'TTS_EMPTY_TEXT'
      throw err
    }

    const url = `${this.baseURL}/audio/speech`
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text.trim(),
        voice: voiceId,
        speed,
        response_format: 'mp3',
      }),
      signal: opts.signal ?? undefined,
    })

    if (!res.ok) {
      let detail = ''
      try { detail = await res.text() } catch {}
      const err = new Error(`OpenAI TTS ${res.status}` + (detail ? ': ' + detail.slice(0, 200) : ''))
      err.code = 'TTS_UPSTREAM_ERROR'
      err.status = res.status
      throw err
    }

    const arrayBuf = await res.arrayBuffer()
    return Buffer.from(arrayBuf)
  }
}