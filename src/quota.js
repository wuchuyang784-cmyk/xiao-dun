/**
 * Provider quota tracking for the web runtime.
 *
 * The quota layer keeps a rolling one-minute window for request/token usage,
 * tracks daily limits for supported media capabilities, and exposes the
 * adaptive polling interval used by the runtime.
 */

const LIMITS = {
  RPM: 500,
  TPM: 20_000_000,
}

const window = []
const WINDOW_MS = 60 * 1000
let rateLimitedUntil = 0

function pruneWindow() {
  const cutoff = Date.now() - WINDOW_MS
  while (window.length > 0 && window[0].ts < cutoff) {
    window.shift()
  }
}

/** Record one provider call and its token consumption. */
export function recordUsage(tokens = 0) {
  pruneWindow()
  window.push({ ts: Date.now(), tokens: Math.max(0, Number(tokens) || 0) })
}

/** Return requests and tokens used in the current rolling window. */
export function getWindowUsage() {
  pruneWindow()
  const requests = window.length
  const tokens = window.reduce((sum, entry) => sum + entry.tokens, 0)
  return { requests, tokens }
}

/** Return the larger of the RPM and TPM usage ratios. */
export function getUsageRatio() {
  const { requests, tokens } = getWindowUsage()
  return Math.max(requests / LIMITS.RPM, tokens / LIMITS.TPM)
}

/** Mark the provider as rate limited for ten minutes. */
export function setRateLimited() {
  rateLimitedUntil = Date.now() + 10 * 60 * 1000
  console.log('[quota] provider rate limited; adaptive tick interval set to 10 minutes')
}

export function clearRateLimit() {
  if (rateLimitedUntil > 0) {
    rateLimitedUntil = 0
    console.log('[quota] provider rate limit cleared; normal tick interval restored')
  }
}

export function isRateLimited() {
  if (rateLimitedUntil === 0) return false
  if (Date.now() >= rateLimitedUntil) {
    clearRateLimit()
    return false
  }
  return true
}

/** Calculate the adaptive runtime tick interval in milliseconds. */
export function getAdaptiveTickInterval(baseInterval = 20_000) {
  if (isRateLimited()) return 10 * 60 * 1000

  const ratio = getUsageRatio()
  if (ratio > 0.90) return 120_000
  if (ratio > 0.80) return 40_000
  if (ratio > 0.60) return baseInterval
  if (ratio > 0.30) return 12_000
  return 8_000
}

/** Whether a new provider call should be delayed. */
export function shouldThrottle() {
  return getUsageRatio() > 0.95
}

export function getTickInterval(baseInterval = 300_000) {
  if (isRateLimited()) return 10 * 60 * 1000
  return baseInterval
}

const DAILY_LIMITS = {
  image: 50,
}
const dailyUsage = Object.create(null)

function todayDate() {
  return new Date().toLocaleDateString('sv-SE')
}

export function recordDailyUsage(capability, count = 1) {
  const today = todayDate()
  if (!dailyUsage[capability] || dailyUsage[capability].date !== today) {
    dailyUsage[capability] = { date: today, count: 0 }
  }
  dailyUsage[capability].count += Math.max(0, Number(count) || 0)
}

export function getDailyUsage(capability) {
  const entry = dailyUsage[capability]
  if (!entry || entry.date !== todayDate()) return 0
  return entry.count
}

export function isDailyLimitReached(capability) {
  const limit = DAILY_LIMITS[capability]
  if (!limit) return false
  return getDailyUsage(capability) >= limit
}

export function getQuotaStatus(baseInterval = 300_000) {
  const { requests, tokens } = getWindowUsage()
  const ratio = getUsageRatio()
  const daily = {}

  for (const [capability, limit] of Object.entries(DAILY_LIMITS)) {
    const used = getDailyUsage(capability)
    daily[capability] = {
      used,
      limit,
      ratio: `${((used / limit) * 100).toFixed(1)}%`,
    }
  }

  return {
    requests,
    tokens,
    rpmUsed: `${requests}/${LIMITS.RPM}`,
    tpmUsed: `${tokens}/${LIMITS.TPM}`,
    ratio: `${(ratio * 100).toFixed(1)}%`,
    tickInterval: getTickInterval(baseInterval),
    daily,
  }
}
