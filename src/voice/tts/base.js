// TTS Provider 基类
export default class TtsProvider {
  constructor(opts = {}) {
    this.apiKey = opts.apiKey || ''
    this.baseURL = opts.baseURL || ''
    this.voiceId = opts.voiceId || ''
  }

  /** 列出可用音色 */
  async listVoices() { throw new Error('not implemented') }

  /** 合成音频 Buffer */
  async synthesize(text, opts = {}) { throw new Error('not implemented') }

  /** provider 标识 */
  static get id() { return 'base' }
  static get label() { return 'Base' }
}