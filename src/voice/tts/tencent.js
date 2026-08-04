// 腾讯云 TTS（签名 v3，long_text_speech 简化接口）
import TtsProvider from './base.js'
import crypto from 'node:crypto'

const VOICES = [
  { id: '101001', label: '智瑜（女声·通用）', gender: 'female' },
  { id: '101002', label: '智聆（女声·通用）', gender: 'female' },
  { id: '101003', label: '智美（女声·客服）', gender: 'female' },
  { id: '101004', label: '智云（男声·通用）', gender: 'male' },
  { id: '101005', label: '智莉（女声·温柔）', gender: 'female' },
  { id: '101006', label: '智言（男声·新闻）', gender: 'male' },
  { id: '101007', label: '智娜（女声·粤语）', gender: 'female' },
  { id: '101008', label: '智琪（女声·儿童）', gender: 'female' },
  { id: '101009', label: '智芸（女声·知性）', gender: 'female' },
  { id: '101010', label: '智华（男声·浑厚）', gender: 'male' },
  { id: '101011', label: '智燕（女声·新闻）', gender: 'female' },
  { id: '101012', label: '智丹（女声·情感）', gender: 'female' },
  { id: '101013', label: '智辉（男声·少儿）', gender: 'male' },
  { id: '101014', label: '智宁（男声·温和）', gender: 'male' },
  { id: '101015', label: '智萌（女声·甜心）', gender: 'female' },
  { id: '101016', label: '智彤（女声·粤语）', gender: 'female' },
  { id: '101017', label: '智刚（男声·硬朗）', gender: 'male' },
  { id: '101018', label: '智瑞（男声·客服）', gender: 'male' },
  { id: '101019', label: '智瑶（女声·四川话）', gender: 'female' },
  { id: '101020', label: '智龙（男声·演讲）', gender: 'male' },
  { id: '101021', label: '智麦（女声·直播）', gender: 'female' },
  { id: '101022', label: '智洁（女声·耳语音）', gender: 'female' },
  { id: '101023', label: '智婧（女声·活泼）', gender: 'female' },
  { id: '101024', label: '智翔（男声·青年）', gender: 'male' },
  { id: '101025', label: '智研（女声·学术）', gender: 'female' },
  { id: '101026', label: '智言（男声·新闻）', gender: 'male' },
  { id: '101027', label: '智库（男声·沉稳）', gender: 'male' },
  { id: '101028', label: '智樊（女声·古风）', gender: 'female' },
  { id: '101029', label: '智宇（男声·解说）', gender: 'male' },
  { id: '101030', label: '智甜（女声·明亮）', gender: 'female' },
  { id: '101031', label: '智瑞（女声·温柔）', gender: 'female' },
  { id: '101032', label: '智萌（女声·少儿）', gender: 'female' },
  { id: '101033', label: '智彤（女声·童声）', gender: 'female' },
  { id: '101034', label: '智彤（女声·配音）', gender: 'female' },
  { id: '101035', label: '智柯（男声·活泼）', gender: 'male' },
]

function signRequest(opts) {
  const { secretId, secretKey, service, action, payload, region = 'ap-guangzhou', version = '2019-08-23', timestamp, host = 'tts.tencentcloudapi.com' } = opts
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`
  const signedHeaders = 'content-type;host'
  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex')
  const canonicalRequest = [
    'POST',
    '/',
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const algorithm = 'TC3-HMAC-SHA256'
  const requestTimestamp = timestamp
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = [
    algorithm,
    requestTimestamp,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n')

  const secretDate = crypto.createHmac('sha256', 'TC3' + secretKey).update(date).digest()
  const secretService = crypto.createHmac('sha256', secretDate).update(service).digest()
  const secretSigning = crypto.createHmac('sha256', secretService).update('tc3_request').digest()
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex')

  return {
    Authorization: `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'X-TC-Action': action,
    'X-TC-Timestamp': String(timestamp),
    'X-TC-Version': version,
    'X-TC-Region': region,
  }
}

export default class TencentTts extends TtsProvider {
  static get id() { return 'tencent' }
  static get label() { return '腾讯云 TTS' }

  constructor(opts = {}) {
    super(opts)
    this.secretId = opts.secretId || ''
    this.secretKey = opts.secretKey || ''
    this.region = opts.region || 'ap-guangzhou'
  }

  async listVoices() {
    return VOICES.map(v => ({ ...v, provider: 'tencent' }))
  }

  async synthesize(text, opts = {}) {
    const voiceId = opts.voiceId || this.voiceId || VOICES[0].id
    const speed = opts.speed || 1.0
    const format = opts.format || 'mp3'

    if (!this.secretId || !this.secretKey) {
      const err = new Error('腾讯云 TTS 未配置 SecretId/SecretKey')
      err.code = 'TTS_NO_KEY'
      throw err
    }
    if (!text || !text.trim()) {
      const err = new Error('TTS 合成文本为空')
      err.code = 'TTS_EMPTY_TEXT'
      throw err
    }

    const payload = JSON.stringify({
      Text: text.trim(),
      VoiceType: parseInt(voiceId, 10) || 101001,
      Speed: speed,
      Codec: format,
      SampleRate: 24000,
    })

    const headers = signRequest({
      secretId: this.secretId,
      secretKey: this.secretKey,
      service: 'tts',
      action: 'TextToVoice',
      payload,
      region: this.region,
      timestamp: Math.floor(Date.now() / 1000),
    })

    const res = await fetch(`https://tts.tencentcloudapi.com/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
      body: payload,
      signal: opts.signal ?? undefined,
    })

    if (!res.ok) {
      let detail = ''
      try { detail = await res.text() } catch {}
      const err = new Error(`腾讯云 TTS ${res.status}` + (detail ? ': ' + detail.slice(0, 200) : ''))
      err.code = 'TTS_UPSTREAM_ERROR'
      err.status = res.status
      throw err
    }

    const data = await res.json()
    if (!data?.Response?.Audio) {
      const err = new Error('腾讯云 TTS 返回无音频')
      err.code = 'TTS_EMPTY_RESPONSE'
      throw err
    }
    return Buffer.from(data.Response.Audio, 'base64')
  }
}