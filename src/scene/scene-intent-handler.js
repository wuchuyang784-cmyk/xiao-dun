// Scene intent 的通用状态变更。
// dismiss 属于被动 UI 意图：用户关闭卡片后，立即从 SceneStore 删除，
// 由 scene-server 广播 remove patch，避免卡片在刷新或重连后再次出现。

import { sceneStore } from './scene-store.js'

export function dismissSceneSurfaceForIntent(msg, store = sceneStore) {
  if (!msg || msg.name !== 'dismiss') return false
  const surfaceId = typeof msg.surface === 'string' ? msg.surface.trim() : ''
  if (!surfaceId) return false
  store.set(surfaceId, null)
  return true
}