import { emitEvent } from '../../../events.js'
import { callCapability } from '../../../providers/registry.js'
import { isDailyLimitReached } from '../../../quota.js'

export async function execGenerateImage({ prompt, aspect_ratio = '1:1', n = 1 }) {
  if (!prompt) return '??????????'
  if (isDailyLimitReached('image')) return '???????????????20 ?/??'

  const validRatios = new Set(['1:1', '16:9', '4:3', '3:4', '9:16'])
  const ratio = validRatios.has(aspect_ratio) ? aspect_ratio : '1:1'
  const count = Math.min(Math.max(Math.floor(n) || 1, 1), 4)
  const result = await callCapability('image', { prompt, aspect_ratio: ratio, n: count })

  emitEvent('image_created', { urls: result.urls, prompt: prompt.slice(0, 60) })
  console.log(`[image] generated ${result.urls.length} image(s)`)
  return `??????${result.urls.length} ???\n${result.urls.join('\n')}`
}
