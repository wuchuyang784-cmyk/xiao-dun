// Automatically detect and save cloud ASR provider keys from the current message.
import { setVoiceConfig } from './config.js'

function extractCandidateKeys(text) {
  const seen = new Set()
  const results = []
  const re = /[A-Za-z0-9\-_\.]{20,120}/g
  let match
  while ((match = re.exec(text)) !== null) {
    if (!seen.has(match[0])) {
      seen.add(match[0])
      results.push({ key: match[0], index: match.index })
    }
  }
  return results
}

function isValidAliyunAsrKey(key) {
  return /^sk-[A-Za-z0-9_\-.]{20,}$/.test(String(key || '').trim())
}

const ASR_RULES = [
  {
    re: /aliyun|\u963f\u91cc\u4e91|\u767e\u70bc|dashscope|paraformer/,
    service: 'asr', provider: 'aliyun', label: '\u963f\u91cc\u4e91 ASR',
    makeConfig: (key) => ({ configUpdates: { voiceProvider: 'aliyun', aliyunApiKey: key } }),
  },
  {
    re: /tencent|\u817e\u8baf.*(?:asr|\u8bc6\u522b)|(?:asr|\u8bc6\u522b).*\u817e\u8baf|secret[\s_\-]?id/,
    service: 'asr', provider: 'tencent', label: '\u817e\u8baf\u4e91 ASR',
    makeConfig: (key, key2) => ({
      configUpdates: { tencentSecretId: key, ...(key2 ? { tencentSecretKey: key2 } : {}) },
    }),
  },
  {
    re: /xunfei|\u8baf\u98de|iflytek/,
    service: 'asr', provider: 'xunfei', label: '\u8baf\u98de ASR',
    makeConfig: (key, key2) => ({
      configUpdates: { voiceProvider: 'xunfei', xunfeiAppId: key, ...(key2 ? { xunfeiApiKey: key2 } : {}) },
    }),
  },
  {
    re: /volcengine.*(?:asr|\u8bc6\u522b)|(?:asr|\u8bc6\u522b).*volcengine|\u706b\u5c71.*(?:asr|\u8bc6\u522b)|(?:asr|\u8bc6\u522b).*\u706b\u5c71|\u8c46\u5305.*(?:asr|\u8bc6\u522b)|(?:asr|\u8bc6\u522b).*\u8c46\u5305/,
    service: 'asr', provider: 'volcengine', label: '\u706b\u5c71\u8c46\u5305 ASR',
    makeConfig: (key) => ({
      configUpdates: {
        voiceProvider: 'volcengine',
        volcAsrApiKey: key,
        volcAsrResourceId: 'volc.seedasr.sauc.duration',
      },
    }),
  },
]

export function detectAllKeyInfos(currentText) {
  const text = String(currentText || '')
  const normalized = text.toLowerCase()
  const keys = extractCandidateKeys(text)
  if (keys.length === 0) return []

  const results = []
  const usedKeyIndices = new Set()
  for (const rule of ASR_RULES) {
    if (!rule.re.test(normalized)) continue
    const available = keys.filter((candidate, index) => !usedKeyIndices.has(index))
    const nearest = available[0]
    if (!nearest) continue
    const nearestIndex = keys.indexOf(nearest)
    const needsSecond = rule.provider === 'tencent' || rule.provider === 'xunfei'
    const next = needsSecond ? available[1] : null
    const nextIndex = next ? keys.indexOf(next) : -1
    usedKeyIndices.add(nearestIndex)
    if (nextIndex >= 0) usedKeyIndices.add(nextIndex)
    const config = rule.makeConfig(nearest.key, next?.key)
    results.push({ service: rule.service, provider: rule.provider, label: rule.label, ...config })
  }

  if (results.length === 0 && /\u8bed\u97f3\u8bc6\u522b|\u8bc6\u522b\u8bed\u97f3|asr|\u542c\u5199|\u8f6c\u6587\u5b57|speech[\s_\-]?to[\s_\-]?text/.test(normalized)) {
    const key = keys[0].key
    if (/^sk-[A-Za-z0-9_\-.]{20,}$/.test(key)) {
      results.push({ service: 'asr', provider: 'aliyun', label: '\u963f\u91cc\u4e91 ASR', configUpdates: { voiceProvider: 'aliyun', aliyunApiKey: key } })
    } else if (key.startsWith('AKID')) {
      results.push({ service: 'asr', provider: 'tencent', label: '\u817e\u8baf\u4e91 ASR', configUpdates: { tencentSecretId: key } })
    } else if (/^\d{6,10}$/.test(key)) {
      results.push({ service: 'asr', provider: 'xunfei', label: '\u8baf\u98de ASR', configUpdates: { voiceProvider: 'xunfei', xunfeiAppId: key } })
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
      results.push({ service: 'asr', provider: 'volcengine', label: '\u706b\u5c71\u8c46\u5305 ASR', configUpdates: { voiceProvider: 'volcengine', volcAsrApiKey: key, volcAsrResourceId: 'volc.seedasr.sauc.duration' } })
    }
  }

  return results
}

export async function autoConfigureVoiceKeys(text) {
  const infos = detectAllKeyInfos(text)
  if (infos.length === 0) return null

  const updates = {}
  const errors = []
  for (const info of infos) {
    if (info.provider === 'aliyun' && !isValidAliyunAsrKey(info.configUpdates?.aliyunApiKey)) {
      errors.push('\u963f\u91cc\u4e91 ASR: \u8bf7\u4f7f\u7528\u767e\u70bc/DashScope API Key\uff08sk- \u5f00\u5934\uff09')
      continue
    }
    Object.assign(updates, info.configUpdates)
  }
  if (Object.keys(updates).length > 0) {
    setVoiceConfig(updates)
    return { ok: true }
  }
  return errors.length ? { ok: false, error: errors.join('\uff1b') } : null
}

export async function tryAutoConfigureKey(text, _recentContext = '') {
  return autoConfigureVoiceKeys(text)
}
