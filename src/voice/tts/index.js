// TTS Provider 工厂 + 配置读取
import DoubaoTts from './doubao.js'
import OpenAITts from './openai.js'
import QwenTts from './qwen.js'
import TencentTts from './tencent.js'
import MiniMaxTts from './minimax.js'
import { getTtsConfig } from '../../config.js'

const PROVIDERS = [DoubaoTts, OpenAITts, QwenTts, TencentTts, MiniMaxTts]

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

  // 腾讯云需要 secretId/secretKey 而不是 API Key
  if (providerId === 'tencent') {
    return new Cls({
      secretId: opts.apiKey || cfg.secretId || '',
      secretKey: opts.apiKey2 || cfg.secretKey || '',
      region: opts.region || cfg.region || 'ap-guangzhou',
      voiceId: opts.voiceId || cfg.voiceId || '',
    })
  }

  return new Cls({
    apiKey: opts.apiKey || cfg.apiKey || '',
    baseURL: opts.baseURL || cfg.baseURL || '',
    appId: opts.appId || cfg.apiKey || '',
    voiceId: opts.voiceId || cfg.voiceId || '',
    model: opts.model || cfg.model || '',
    groupId: opts.groupId || cfg.groupId || '',
    resourceId: opts.resourceId || '',
  })
}

export { getTtsConfig }
