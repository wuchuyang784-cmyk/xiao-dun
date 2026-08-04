// TTS Provider 工厂 + 配置读取
import DoubaoTts from './doubao.js'
import OpenAITts from './openai.js'
import { getTtsConfig } from '../../config.js'

const PROVIDERS = [DoubaoTts, OpenAITts]

/**
 * 获取所有可用的 TTS 厂商信息
 */
export function listTtsProviders() {
  return PROVIDERS.map(P => ({ id: P.id, label: P.label }))
}

/**
 * 根据当前保存的配置创建 TTS Provider 实例
 */
export function createTtsProvider(opts = {}) {
  const cfg = getTtsConfig()
  const providerId = opts.provider || cfg.provider || 'doubao'

  const Cls = PROVIDERS.find(P => P.id === providerId)
  if (!Cls) {
    const err = new Error(`未知的 TTS 厂商: ${providerId}`)
    err.code = 'TTS_UNKNOWN_PROVIDER'
    throw err
  }

  return new Cls({
    apiKey: opts.apiKey || cfg.apiKey || '',
    baseURL: opts.baseURL || cfg.baseURL || '',
    appId: opts.appId || cfg.apiKey || '',
    voiceId: opts.voiceId || cfg.voiceId || '',
    model: opts.model || cfg.model || '',
    resourceId: opts.resourceId || '',
  })
}

export { getTtsConfig }
