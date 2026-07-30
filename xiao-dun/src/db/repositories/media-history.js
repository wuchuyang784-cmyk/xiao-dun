import { getDB } from '../connection.js'

export function upsertMediaHistory({ kind, url, title = '', videoId = null, platform = null }) {
  const db = getDB()
  const now = new Date().toISOString()
  db.prepare(`
    INSERT INTO media_history (kind, url, title, video_id, platform, played_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(url) DO UPDATE SET
      title     = excluded.title,
      played_at = excluded.played_at
  `).run(kind, url, title, videoId || null, platform || null, now)
}

export function getMediaHistory(limit = 30) {
  const db = getDB()
  return db.prepare(`
    SELECT * FROM media_history ORDER BY played_at DESC LIMIT ?
  `).all(limit)
}
