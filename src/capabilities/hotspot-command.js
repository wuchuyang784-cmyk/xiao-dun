export const HOTSPOT_OPEN_COMMAND = '/hot'

export function isHotspotOpenCommand(message = '') {
  return String(message || '').trim() === HOTSPOT_OPEN_COMMAND
}
