import { emitEvent } from '../../events.js'
import { handleSocialWebhook, isSocialWebhookPath } from '../../social/webhooks.js'
import { getClawbotQR, logoutClawbot } from '../../social/wechat-clawbot.js'
import { getFeishuStatus } from '../../social/feishu-ws.js'
import { getAllClawbotTokens } from '../../db.js'
import { dispatchSocialMessage } from '../../social/dispatch.js'
import { jsonResponse } from '../utils.js'

function checkLocalOrToken(req, res, url, requireLocalOrToken) {
  if (typeof requireLocalOrToken === 'function') return requireLocalOrToken(req, res, url)
  jsonResponse(res, 403, { ok: false, error: 'forbidden' })
  return false
}

export async function handleSocialRoutes(req, res, url, { hasAllowedAccess, requireLocalOrToken } = {}) {
  if (req.method === 'GET' && url.pathname === '/social/wechat-clawbot/qr') {
    if (!hasAllowedAccess?.(req, url)) {
      jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return true
    }
    jsonResponse(res, 200, { ok: true, ...getClawbotQR() })
    return true
  }

  if (req.method === 'GET' && url.pathname === '/social/feishu/status') {
    if (!hasAllowedAccess?.(req, url)) {
      jsonResponse(res, 403, { ok: false, error: 'forbidden' })
      return true
    }
    const configured = !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET)
    jsonResponse(res, 200, { ok: true, status: getFeishuStatus(), configured })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/social/wechat-clawbot/logout') {
    if (!checkLocalOrToken(req, res, url, requireLocalOrToken)) return true
    logoutClawbot()
    emitEvent('social_status', { platform: 'wechat-clawbot', status: 'idle' })
    jsonResponse(res, 200, { ok: true })
    return true
  }

  if (req.method === 'POST' && url.pathname === '/social/test-fraud-push') {
    if (!checkLocalOrToken(req, res, url, requireLocalOrToken)) return true
    const tokens = getAllClawbotTokens()
    const results = []
    for (const { from_user_id } of tokens) {
      const r = await dispatchSocialMessage(`wechat:clawbot:${from_user_id}`, {
        text: '【小盾反诈·通路测试】微信推送链路已接通。后续定时采集到新型诈骗案例时，会自动通过此通道推送给您。',
      })
      results.push({ user: from_user_id, ok: r?.ok, reason: r?.reason || r?.error || null })
    }
    jsonResponse(res, 200, { ok: true, pushed: results.length, results })
    return true
  }

  if (isSocialWebhookPath(url.pathname)) {
    await handleSocialWebhook(req, res, url)
    return true
  }

  return false
}
