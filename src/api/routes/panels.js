import { getHotspots, getHotspotPanelState, setHotspotPanelState } from '../../hotspots.js'
import { DOC_TOPICS, getDocPanelState, setDocPanelState } from '../../docs.js'
import { getGeoWeatherSnapshot } from '../../geo-weather.js'
import { getAgentName } from '../agent.js'
import { jsonResponse, parseBooleanish, readJsonBody } from '../utils.js'

export async function handlePanelRoutes(req, res, url, { getStateSnapshot = null } = {}) {
  if (req.method === 'GET' && url.pathname === '/hotspots') {
    getHotspots({
      force: /^(1|true|yes)$/i.test(url.searchParams.get('refresh') || ''),
      viewed: /^(1|true|yes)$/i.test(url.searchParams.get('viewed') || ''),
    })
      .then((hotspots) => jsonResponse(res, 200, hotspots))
      .catch((err) => jsonResponse(res, 502, {
        ok: false,
        error: err.message,
        refreshMinutes: 30,
        platforms: {},
      }))
    return true
  }

  if (url.pathname === '/hotspot-state') {
    if (req.method === 'GET') {
      jsonResponse(res, 200, { ok: true, state: getHotspotPanelState() })
      return true
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req)
        const active = parseBooleanish(body.active)
        const state = setHotspotPanelState({ active, source: body.source || 'brain-ui' })
        jsonResponse(res, 200, { ok: true, state })
      } catch (err) {
        jsonResponse(res, 400, { ok: false, error: err.message })
      }
      return true
    }
  }

  if (url.pathname === '/doc-panel-state') {
    if (req.method === 'GET') {
      jsonResponse(res, 200, { ok: true, state: getDocPanelState() })
      return true
    }
    if (req.method === 'POST') {
      try {
        const body = await readJsonBody(req)
        const active = parseBooleanish(body.active)
        const topic = typeof body.topic === 'string' ? body.topic : undefined
        const state = setDocPanelState({ active, topic, source: body.source || 'brain-ui' })
        jsonResponse(res, 200, { ok: true, state })
      } catch (err) {
        jsonResponse(res, 400, { ok: false, error: err.message })
      }
      return true
    }
  }

  if (req.method === 'GET' && url.pathname === '/geo-weather') {
    getGeoWeatherSnapshot()
      .then((weather) => jsonResponse(res, 200, weather))
      .catch((err) => jsonResponse(res, 502, { ok: false, error: err.message }))
    return true
  }

  if (req.method === 'GET' && url.pathname === '/agent') {
    jsonResponse(res, 200, { name: getAgentName() })
    return true
  }

  return false
}
