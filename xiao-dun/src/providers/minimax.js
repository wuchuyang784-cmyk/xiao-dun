import { BaseProvider } from './base.js'
import { recordDailyUsage, getDailyUsage } from '../quota.js'

const CAPABILITIES = ['image']

const DAILY_LIMITS = {
  image: 50,
}

export class MinimaxProvider extends BaseProvider {
  constructor({ apiKey }) {
    super({
      name: 'minimax',
      apiKey,
      baseURL: 'https://api.minimaxi.com/v1',
    })
  }

  canDo(capability) {
    return CAPABILITIES.includes(capability)
  }

  async call(capability, params) {
    switch (capability) {
      case 'image': return this.#image(params)
      default: throw new Error(`MinimaxProvider: unsupported capability "${capability}"`)
    }
  }

  getQuotaStatus() {
    const status = {}
    for (const cap of CAPABILITIES) {
      const used = getDailyUsage(cap)
      const limit = DAILY_LIMITS[cap]
      status[cap] = { used, limit, ratio: `${((used / limit) * 100).toFixed(1)}%` }
    }
    return status
  }

  async #image({ prompt, aspect_ratio = '1:1', n = 1 }) {
    if (!prompt) throw new Error('image: missing prompt')
    const data = await this.request('/image_generation', {
      model: 'image-01',
      prompt,
      aspect_ratio,
      n,
      response_format: 'url',
    })
    if (!data?.data?.image_urls?.length) throw new Error('image: response has no image URL')
    recordDailyUsage('image', n)
    return { urls: data.data.image_urls }
  }
}
