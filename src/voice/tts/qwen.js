// 阿里云百炼 Qwen TTS（DashScope 平台）
import TtsProvider from './base.js'

const PREFERRED_MODEL = 'qwen-tts'

const VOICES = [
  { id: 'Cherry', label: 'Cherry · 甜美女声（多语言）', gender: 'female' },
  { id: 'Serena', label: 'Serena · 温柔女声（多语言）', gender: 'female' },
  { id: 'Ethan', label: 'Ethan · 磁性男声（多语言）', gender: 'male' },
  { id: 'Chelsie', label: 'Chelsie · 清亮女声（中英）', gender: 'female' },
  { id: 'Momo', label: 'Momo · 活力女声（中英）', gender: 'female' },
  { id: 'Vivian', label: 'Vivian · 温润女声（中英）', gender: 'female' },
  { id: 'Moon', label: 'Moon · 治愈女声（中文）', gender: 'female' },
  { id: 'Maia', label: 'Maia · 知性女声（中文）', gender: 'female' },
]

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation'

export default class QwenTts extends TtsProvider {
  static get id() { return 'qwen' }
  static get label() { return '阿里云百炼 Qwen TTS' }

  constructor(opts = {}) {
    super(opts)
    this.baseURL = opts.baseURL || DEFAULT_BASE_URL
    this.model = opts.model || PREFERRED_MODEL
  }

  async listVoices() {
    return VOICES.map(v => ({ ...v, provider: 'qwen' }))
  }

  async synthesize(text, opts = {}) {
    const voiceId = opts.voiceId || this.voiceId || VOICES[0].id
    const speed = opts.speed || 1.0
    const model = opts.model || this.model

    if (!this.apiKey) {
      const err = new Error('阿里云百炼 TTS 未配置 API Key')
      err.code = 'TTS_NO_KEY'
      throw err
    }
    if (!text || !text.trim()) {
      const err = new Error('TTS 合成文本为空')
      err.code = 'TTS_EMPTY_TEXT'
      throw err
    }

    const url = `${this.baseURL}/generation`
    const body = {
      model,
      input: {
        text: text.trim(),
        voice: voiceId,
        language_type: 'Auto',
      },
      parameters: {
        speech_rate: Math.round((speed - 1) * 100) / 100,
        format: 'mp3',
        sample_rate: 24000,
      },
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: opts.signal ?? undefined,
    })

    if (!res.ok) {
      let detail = ''
      try { detail = await res.text() } catch {}
      const err = new Error(`阿里云 TTS ${res.status}` + (detail ? ': ' + detail.slice(0, 200) : ''))
      err.code = 'TTS_UPSTREAM_ERROR'
      err.status = res.status
      throw err
    }

    const data = await res.json()
    const audioUrl = data?.output?.audio?.url
    if (!audioUrl) {
      const err = new Error('TTS response missing audio URL')
      err.code = 'TTS_EMPTY_RESPONSE'
      throw err
    }
    // 阿里云返回 OSS 临时链接，需 GET 一次
    // DashScope may return an http OSS URL even though the API request is HTTPS.
    // Fetch the HTTPS equivalent so browser/server security policies do not reject it.
    const downloadUrl = String(audioUrl).replace(/^http:/i, 'https:')
    const audioRes = await fetch(downloadUrl)
    if (!audioRes.ok) {
      const err = new Error(`阿里云 TTS 音频下载失败 ${audioRes.status}`)
      err.code = 'TTS_UPSTREAM_ERROR'
      err.status = audioRes.status
      throw err
    }
    const arrayBuf = await audioRes.arrayBuffer()
    return Buffer.from(arrayBuf)
  }
}