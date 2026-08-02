// 媒体类工具 schema：media_mode
export const mediaSchemas = {
  media_mode: {
    type: 'function',
    function: {
      name: 'media_mode',
      description: `Control the brain-ui media stage. Video opens from the right and images open from the left.
Platform selection (check Country Code / Timezone from Supplemental Context):
  - China (CN / Asia/Shanghai etc.) → prefer Bilibili for videos.
  - Other regions → prefer YouTube for videos.
Video URL rules, important because violations can cause a blank player:
  - YouTube: use a full watch URL such as https://www.youtube.com/watch?v=xxx or a youtu.be short link. A bare videoId string is invalid. The video must be public and embeddable, not private, region-locked, or login-gated.
  - Bilibili: the URL must include a BV id, such as https://www.bilibili.com/video/BVxxxxx.
  - Direct video links: must be directly accessible .mp4/.webm or similar URLs; confirm the link works and allows cross-origin access.
  - Never pass guessed URLs, inaccessible private videos, or platform share pages that are not embeddable playback links.
  - Recommended: use search first to find and confirm the video, then call media_mode. Prefer official channels and high-view public videos.
Pressing V only pauses and collapses the video panel while preserving content; close/hide actions destroy the video.`,
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['video', 'image'], description: 'video=right-side video mode; image=left-side image mode.' },
          action: { type: 'string', enum: ['show', 'hide', 'close', 'play', 'pause', 'seek', 'set_volume', 'update'], description: 'show loads media; hide/close closes and destroys it; play/pause controls playback; seek jumps; set_volume adjusts volume.' },
          url: { type: 'string', description: 'Media URL for video/image. Must be a complete accessible URL following the tool rules.' },
          title: { type: 'string', description: 'Optional media title.' },
          alt: { type: 'string', description: 'Optional image alt description.' },
          autoplay: { type: 'boolean', description: 'Autoplay, default true.' },
          muted: { type: 'boolean', description: 'Mute direct-link video, default false.' },
          volume: { type: 'number', description: 'Volume 0-1.' },
          currentTime: { type: 'number', description: 'Seconds to seek to.' },
        },
        required: ['mode']
      }
    }
  },
}
