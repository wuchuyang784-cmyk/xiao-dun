// TTS Provider 工厂 + 配置读写
import DoubaoTts from './doubao.js'
import OpenAITts from './openai.js'
import { readExistingStoredConfig } from '../../config.js'

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
  const stored = readExistingStoredConfig()
  const tts = stored?.tts || {}
  const providerId = opts.provider || tts.ttsProvider || 'doubao'

  const Cls = PROVIDERS.find(P => P.id === providerId)
  if (!Cls) {
    const err = new Error(`未知的 TTS 厂商: ${providerId}`)
    err.code = 'TTS_UNKNOWN_PROVIDER'
    throw err
  }

  return new Cls({
    apiKey: opts.apiKey || tts.doubaoKey || tts.openaiTtsKey || '',
    baseURL: opts.baseURL || tts.openaiTtsBaseURL || '',
    appId: opts.appId || tts.doubaoAppId || '',
    voiceId: opts.voiceId || tts.ttsVoiceId || '',
    model: opts.model || tts.ttsModel || '',
    resourceId: opts.resourceId || tts.doubaoResourceId || '',
  })
}

/**
 * 获取当前 TTS 配置（给前端 settings 用）
 */
export function getTtsConfig() {
  const stored = readExistingStoredConfig()
  const tts = stored?.tts || {}
  return {
    provider: tts.ttsProvider || '',
    apiKey: tts.doubaoKey || tts.openaiTtsKey || '',
    voiceId: tts.ttsVoiceId || '',
    configured: !!(tts.doubaoKey || tts.openaiTtsKey),
  }
}
