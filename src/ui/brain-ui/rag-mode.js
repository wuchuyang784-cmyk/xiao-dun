import { apiUrl } from './api-client.js'

const ACTIVATION_PATH = '/api/v1/rag/activate'
const FALLBACK_EXPECTED_COUNT = 9975

function setText(id, value) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function initRagMode({ fraudMap, openChat, closeHotspot } = {}) {
  const body = document.body
  const overlay = document.getElementById('rag-boot-overlay')
  const progress = document.getElementById('rag-progress-bar')
  const retry = document.getElementById('rag-retry')
  const closeButton = document.getElementById('rag-close')
  let activationId = 0

  function setProgress(value) {
    if (progress) progress.style.width = `${Math.max(0, Math.min(100, value))}%`
  }

  function setPhase(title, detail, value) {
    setText('rag-boot-title', title)
    setText('rag-boot-detail', detail)
    setProgress(value)
  }

  function close() {
    activationId += 1
    body.classList.remove('rag-mode', 'rag-mode-booting', 'rag-mode-ready', 'rag-mode-error')
    fraudMap?.deactivate?.()
  }

  async function requestReadiness() {
    const response = await fetch(apiUrl(ACTIVATION_PATH), {
      method: 'POST',
      headers: { Accept: 'application/json' },
    })
    const envelope = await response.json().catch(() => null)
    if (!response.ok || envelope?.code !== 0 || !envelope?.data?.ready) {
      throw new Error(envelope?.message || `RAG activation failed (HTTP ${response.status})`)
    }
    return envelope.data
  }

  async function open() {
    const currentId = ++activationId
    closeHotspot?.()
    body.classList.remove('video-mode', 'image-mode', 'doc-panel-mode')
    body.classList.add('rag-mode', 'rag-mode-booting')
    body.classList.remove('rag-mode-ready', 'rag-mode-error')
    if (retry) retry.hidden = true
    openChat?.()
    setPhase('\u6b63\u5728\u8fde\u63a5 RAG \u77e5\u8bc6\u5e93', '\u68c0\u6d4b PostgreSQL + pgvector \u670d\u52a1', 18)

    try {
      const readinessPromise = requestReadiness()
      await delay(260)
      if (currentId !== activationId) return
      setPhase('\u6b63\u5728\u6821\u9a8c\u8bed\u4e49\u7d22\u5f15', `\u9884\u671f ${FALLBACK_EXPECTED_COUNT.toLocaleString('zh-CN')} \u6761\u5371\u9669\u6587\u672c\u4e0e\u5411\u91cf`, 48)
      const readiness = await readinessPromise
      if (currentId !== activationId) return
      setPhase('\u6b63\u5728\u8f7d\u5165\u7701\u7ea7\u5206\u5e03', `${readiness.vectorCount.toLocaleString('zh-CN')} \u6761\u5411\u91cf\u5df2\u5c31\u7eea \u00b7 ${readiness.embeddingDimension || 512} \u7ef4`, 76)
      await fraudMap?.activate?.()
      if (currentId !== activationId) return
      setPhase('RAG \u77e5\u8bc6\u7f51\u7edc\u5df2\u70b9\u4eae', `${readiness.textCount.toLocaleString('zh-CN')} \u6761\u6587\u672c \u00b7 ${readiness.vectorCount.toLocaleString('zh-CN')} \u6761\u5411\u91cf \u00b7 34 \u4e2a\u7701\u7ea7\u533a\u57df`, 100)
      await delay(420)
      if (currentId !== activationId) return
      body.classList.remove('rag-mode-booting')
      body.classList.add('rag-mode-ready')
      fraudMap?.resize?.()
    } catch (error) {
      if (currentId !== activationId) return
      body.classList.remove('rag-mode-booting', 'rag-mode-ready')
      body.classList.add('rag-mode-error')
      setPhase('RAG \u77e5\u8bc6\u5e93\u672a\u5c31\u7eea', error?.message || '\u8bf7\u68c0\u67e5 RAG \u670d\u52a1', 100)
      if (retry) retry.hidden = false
    }
  }

  retry?.addEventListener('click', () => void open())
  closeButton?.addEventListener('click', close)
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && body.classList.contains('rag-mode')) close()
  })

  if (overlay) overlay.dataset.ragController = 'ready'
  return { open, close }
}
