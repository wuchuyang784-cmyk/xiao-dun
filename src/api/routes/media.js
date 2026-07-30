import fs from 'fs'
import path from 'path'
import { paths } from '../../paths.js'
import { getMediaHistory, upsertMediaHistory } from '../../db.js'
import { mimeFromChatMediaExt } from '../../chat-media.js'
import { isPathInside, jsonResponse, readJsonBody } from '../utils.js'

function streamFile(req, res, filePath, contentType, { cacheControl = 'no-cache', range = false } = {}) {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      res.writeHead(404)
      res.end('media not found')
      return
    }
    const total = stat.size
    const rangeHeader = range ? req.headers.range : null
    if (rangeHeader) {
      const m = rangeHeader.match(/bytes=(\d*)-(\d*)/)
      const start = m?.[1] ? parseInt(m[1]) : 0
      const end = m?.[2] ? parseInt(m[2]) : total - 1
      res.writeHead(206, {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Cache-Control': cacheControl,
      })
      fs.createReadStream(filePath, { start, end }).pipe(res)
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': total,
        ...(range ? { 'Accept-Ranges': 'bytes' } : {}),
        'Cache-Control': cacheControl,
      })
      fs.createReadStream(filePath).pipe(res)
    }
  } catch {
    res.writeHead(404)
    res.end('media not found')
  }
}

function ensureInside(res, root, filePath, { allowRoot = true } = {}) {
  if (isPathInside(root, filePath) && (allowRoot || path.resolve(root) !== path.resolve(filePath))) return true
  res.writeHead(403)
  res.end('forbidden')
  return false
}

export async function handleMediaRoutes(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/media/history') {
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '30'), 100)
    jsonResponse(res, 200, getMediaHistory(limit))
    return true
  }

  if (req.method === 'POST' && url.pathname === '/media/history') {
    try {
      const body = await readJsonBody(req)
      if (!body.url || !body.kind) {
        jsonResponse(res, 400, { ok: false, error: 'url and kind required' })
        return true
      }
      upsertMediaHistory(body)
      jsonResponse(res, 200, { ok: true })
    } catch (e) {
      jsonResponse(res, 400, { ok: false, error: e.message })
    }
    return true
  }

  if (req.method === 'GET' && url.pathname.startsWith('/media/video/')) {
    const raw = url.pathname.slice('/media/video/'.length)
    const filename = path.basename(decodeURIComponent(raw))
    const videoDir = path.join(paths.sandboxDir, 'videos')
    const filePath = path.join(videoDir, filename)
    if (!ensureInside(res, videoDir, filePath)) return true
    const mimeMap = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' }
    const contentType = mimeMap[path.extname(filename).toLowerCase()] || 'video/mp4'
    streamFile(req, res, filePath, contentType, { range: true })
    return true
  }

  if (req.method === 'GET' && url.pathname.startsWith('/media/chat/')) {
    const raw = url.pathname.slice('/media/chat/'.length)
    const filename = path.basename(decodeURIComponent(raw))
    const mediaDir = paths.mediaDir
    const filePath = path.join(mediaDir, filename)
    if (!ensureInside(res, mediaDir, filePath, { allowRoot: false })) return true
    const contentType = mimeFromChatMediaExt(path.extname(filename).toLowerCase())
    streamFile(req, res, filePath, contentType, { cacheControl: 'public, max-age=31536000, immutable' })
    return true
  }

  if (req.method === 'GET' && url.pathname.startsWith('/audio/')) {
    const filename = path.basename(url.pathname)
    const filePath = path.join(paths.sandboxDir, 'audio', filename)
    streamFile(req, res, filePath, 'audio/mpeg')
    return true
  }

  return false
}
