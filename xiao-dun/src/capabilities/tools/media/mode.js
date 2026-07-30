import { emitEvent } from '../../../events.js'
import { getCountryCode } from '../../../geo-weather.js'

const MEDIA_MODES = new Set(['video', 'image'])
const MEDIA_ACTIONS = new Set(['show', 'hide', 'close', 'play', 'pause', 'seek', 'set_volume', 'update'])

export function execMediaMode(args = {}) {
  const mode = String(args.mode || args.kind || '').trim()
  const action = String(args.action || 'show').trim()
  if (!MEDIA_MODES.has(mode)) {
    return JSON.stringify({ ok: false, tool: 'media_mode', error: 'mode must be video or image' })
  }
  if (!MEDIA_ACTIONS.has(action)) {
    return JSON.stringify({ ok: false, tool: 'media_mode', error: 'unsupported action' })
  }

  if (mode === 'video' && action === 'show') {
    const url = String(args.url || args.src || '')
    if (/youtube\.com|youtu\.be/i.test(url)) {
      const countryCode = getCountryCode()
      if (countryCode === 'CN' || countryCode === null) {
        emitEvent('action', { tool: 'media_mode', summary: 'YouTube video rejected in CN network', detail: url.slice(0, 60) })
        return JSON.stringify({
          ok: false,
          tool: 'media_mode',
          error: 'youtube_not_embeddable_cn',
          guide: '???????????? YouTube?????????????',
        })
      }
    }
  }

  const payload = {
    mode,
    action,
    url: typeof args.url === 'string' ? args.url : undefined,
    src: typeof args.src === 'string' ? args.src : undefined,
    title: typeof args.title === 'string' ? args.title : undefined,
    alt: typeof args.alt === 'string' ? args.alt : undefined,
    autoplay: typeof args.autoplay === 'boolean' ? args.autoplay : undefined,
    muted: typeof args.muted === 'boolean' ? args.muted : undefined,
  }

  if (Number.isFinite(Number(args.volume))) {
    payload.volume = Math.max(0, Math.min(1, Number(args.volume)))
  }
  if (Number.isFinite(Number(args.currentTime ?? args.time ?? args.seek))) {
    payload.currentTime = Math.max(0, Number(args.currentTime ?? args.time ?? args.seek))
  }

  emitEvent('media_mode', payload)
  emitEvent('action', { tool: 'media_mode', summary: `${mode}:${action}`, detail: payload.title || payload.url || payload.src || '' })
  return JSON.stringify({ ok: true, tool: 'media_mode', ...payload })
}
