// MiniMax TTS（HTTP API，speech-01 模型）
import TtsProvider from './base.js'

const PREFERRED_MODEL = 'speech-01'

const VOICES = [
  { id: 'male-qn-qingse', label: '青涩男声', gender: 'male' },
  { id: 'male-qn-jingying', label: '精英男声', gender: 'male' },
  { id: 'male-qn-badao', label: '霸道男声', gender: 'male' },
  { id: 'female-shaonv', label: '少女女声', gender: 'female' },
  { id: 'female-yujie', label: '御姐女声', gender: 'female' },
  { id: 'female-chengshu', label: '成熟女声', gender: 'female' },
  { id: 'presenter_male', label: '男主播', gender: 'male' },
  { id: 'presenter_female', label: '女主播', gender: 'female' },
  { id: 'audiobook_male_1', label: '有声书男声', gender: 'male' },
  { id: 'audiobook_female_1', label: '有声书女声', gender: 'female' },
]

const DEFAULT_BASE_URL = 'https://api.MiniMax.chat/v1'

export default class MiniMaxTts extends TtsProvider {
  static get id() { return 'minimax' }
  static get label() { return 'MiniMax TTS' }

  constructor(opts = {}) {
    super(opts)
    this.baseURL = opts.baseURL || DEFAULT_BASE_URL
    this.model = opts.model || PREFERRED_MODEL
    this.groupId = opts.groupId || ''
  }

  async listVoices() {
    return VOICES.map(v => ({ ...v, provider: 'minimax' }))
  }

  async synthesize(text, opts = {}) {
    const voiceId = opts.voiceId || this.voiceId || VOICES[0].id
    const speed = opts.speed || 1.0
    const model = opts.model || this.model

    if (!this.apiKey) {
      const err = new Error('MiniMax TTS 未配置 API Key')
      err.code = 'TTS_NO_KEY'
      throw err
    }
    if (!text || !text.trim()) {
      const err = new Error('TTS 合成文本为空')
      err.code = 'TTS_EMPTY_TEXT'
      throw err
    }

    const url = `${this.baseURL}/text_to_speech/synthesize`
    const body = {
      model,
      text: text.trim(),
      voice_setting: {
        voice_id: voiceId,
        speed: Math.max(0.5, Math.min(2.0, speed)),
        vol: 1.0,
        pitch: 0,
      },
      audio_setting: {
        sample_rate: 32000,
        bitrate: 128000,
        format: 'mp3',
        channel: 1,
      },
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    }
    if (this.groupId) headers['GroupId'] = this.groupId

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal ?? undefined,
    })

    if (!res.ok) {
      let detail = ''
      try { detail = await res.text() } catch {}
      const err = new Error(`MiniMax TTS ${res.status}` + (detail ? ': ' + detail.slice(0, 200) : ''))
      err.code = 'TTS_UPSTREAM_ERROR'
      err.status = res.status
      throw err
    }

    const data = await res.json()
    if (!data?.data?.audio) {
      const err = new Error('MiniMax TTS 返回空音频')
      err.code = 'TTS_EMPTY_RESPONSE'
      throw err
    }
    // MiniMax 返回 hex 字符串
    const hex = data.data.audio
    return Buffer.from(hex, 'hex')
  }
}