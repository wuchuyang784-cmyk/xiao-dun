// 火山引擎豆包 TTS（seed-tts-2.0）
import TtsProvider from './base.js'

const PREFERRED_MODEL = 'seed-tts-2.0'

const VOICES = [
  { id: 'zh_female_xiaohe_uranus_bigtts', label: '小荷（女声·通用）', gender: 'female' },
  { id: 'zh_male_xiaoqing_uranus_bigtts', label: '小清（男声·通用）', gender: 'male' },
  { id: 'zh_female_tianmei_uranus_bigtts', label: '甜美（女声）', gender: 'female' },
  { id: 'zh_male_qingse_uranus_bigtts', label: '青色（男声）', gender: 'male' },
  { id: 'BV001_streaming', label: '灿灿（女声·流式）', gender: 'female' },
  { id: 'BV002_streaming', label: '擎苍（男声·流式）', gender: 'male' },
  { id: 'BV700_streaming', label: '通用女声·流式', gender: 'female' },
  { id: 'BV701_streaming', label: '通用男声·流式', gender: 'male' },
]

export default class DoubaoTts extends TtsProvider {
  static get id() { return 'doubao' }
  static get label() { return '豆包 TTS（火山引擎）' }

  constructor(opts = {}) {
    super(opts)
    this.appId = opts.appId || opts.apiKey || '' // doubao 用 apiKey 做 token
    this.resourceId = opts.resourceId || PREFERRED_MODEL
    this.baseURL = opts.baseURL || 'https://openspeech.bytedance.com/api/v1/tts'
  }

  async listVoices() {
    return VOICES.map(v => ({ ...v, provider: 'doubao' }))
  }

  async synthesize(text, opts = {}) {
    const voiceId = opts.voiceId || this.voiceId || VOICES[0].id
    const speed = opts.speed || 1.0
    const format = opts.format || 'mp3'

    if (!this.apiKey) {
      const err = new Error('豆包 TTS 未配置 API Key')
      err.code = 'TTS_NO_KEY'
      throw err
    }
    if (!text || !text.trim()) {
      const err = new Error('TTS 合成文本为空')
      err.code = 'TTS_EMPTY_TEXT'
      throw err
    }

    const body = {
      app: {
        appid: this.appId,
        token: this.apiKey,
        cluster: 'volcano_tts',
      },
      user: { uid: 'xiaodun' },
      audio: {
        voice_type: voiceId,
        encoding: format,
        speed_ratio: speed,
        rate: 24000,
      },
      request: {
        reqid: crypto.randomUUID(),
        text: text.trim(),
        operation: 'query',
        model: this.resourceId,
      },
    }

    const res = await fetch(this.baseURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer; ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: opts.signal ?? undefined,
    })

    if (!res.ok) {
      let detail = ''
      try { detail = await res.text() } catch {}
      const err = new Error(`豆包 TTS ${res.status}` + (detail ? ': ' + detail.slice(0, 200) : ''))
      err.code = 'TTS_UPSTREAM_ERROR'
      err.status = res.status
      throw err
    }

    const data = await res.json()
    if (!data || !data.data) {
      const err = new Error('豆包 TTS 返回空音频数据')
      err.code = 'TTS_EMPTY_RESPONSE'
      throw err
    }

    return Buffer.from(data.data, 'base64')
  }
}