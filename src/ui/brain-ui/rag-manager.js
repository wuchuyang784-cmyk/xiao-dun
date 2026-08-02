import { apiUrl } from './api-client.js'

const ACTIVATE_PATH = '/api/v1/rag/activate'
const ITEMS_PATH = '/api/v1/rag/items'

async function requestJson(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) },
    ...options,
  })
  const envelope = await response.json().catch(() => null)
  if (!response.ok || envelope?.code !== 0) {
    throw new Error(envelope?.message || `Request failed (HTTP ${response.status})`)
  }
  return envelope.data
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('zh-CN')
}

export function initRagManager({ openChat, closeHotspot, closeRag } = {}) {
  const body = document.body
  const panel = document.getElementById('rag-manager-panel')
  const form = document.getElementById('rag-manager-form')
  const textInput = document.getElementById('rag-item-text')
  const counter = document.getElementById('rag-item-counter')
  const submitButton = document.getElementById('rag-index-button')
  const live = document.getElementById('rag-manager-live')
  const status = document.getElementById('rag-manager-status')
  const recent = document.getElementById('rag-recent-list')
  let busy = false

  function setMetric(id, value) {
    const node = document.getElementById(id)
    if (node) node.textContent = value
  }

  function updateReadiness(data) {
    setMetric('rag-manager-version', data.knowledgeBaseVersion || data.knowledge_base_version || '--')
    setMetric('rag-manager-text-count', formatCount(data.textCount ?? data.text_count))
    setMetric('rag-manager-vector-count', formatCount(data.vectorCount ?? data.vector_count))
    setMetric('rag-manager-dimension', String(data.embeddingDimension ?? data.embedding_dimension ?? 512))
    if (live) {
      live.classList.toggle('error', data.ready === false)
      live.innerHTML = `<i></i>${data.ready === false ? 'INCOMPLETE' : 'ONLINE'}`
    }
  }

  function setStatus(title, detail, state = '') {
    if (!status) return
    status.className = `rag-manager-status ${state}`.trim()
    status.innerHTML = `<b></b><span></span>`
    status.querySelector('b').textContent = title
    status.querySelector('span').textContent = detail
  }

  async function refresh() {
    if (live) live.innerHTML = '<i></i>CONNECTING'
    const data = await requestJson(ACTIVATE_PATH, { method: 'POST' })
    updateReadiness(data)
    return data
  }

  async function open() {
    closeHotspot?.()
    closeRag?.()
    body.classList.remove('video-mode', 'image-mode', 'doc-panel-mode')
    body.classList.add('rag-manager-mode')
    openChat?.()
    requestAnimationFrame(() => panel?.classList.add('active'))
    try {
      await refresh()
      setStatus('知识库已连接', '填写左侧内容即可生成向量并写入现有 RAG 库', 'success')
    } catch (error) {
      if (live) { live.classList.add('error'); live.innerHTML = '<i></i>OFFLINE' }
      setStatus('无法连接知识库', error?.message || '请检查 RAG 服务', 'error')
    }
  }

  function close() {
    if (busy) return
    panel?.classList.remove('active')
    body.classList.remove('rag-manager-mode', 'rag-manager-indexing')
  }

  function addRecent(data, title, categoryLabel) {
    recent?.querySelector('.rag-recent-empty')?.remove()
    const row = document.createElement('div')
    row.className = 'rag-recent-row'
    row.innerHTML = '<i></i><div><b></b><span></span></div><em>INDEXED</em>'
    row.querySelector('b').textContent = title
    row.querySelector('span').textContent = `${categoryLabel} · ${data.risk_text_id}`
    recent?.prepend(row)
    while (recent?.children.length > 5) recent.lastElementChild?.remove()
  }

  async function submit(event) {
    event.preventDefault()
    if (busy || !form?.reportValidity()) return
    const fields = new FormData(form)
    const title = String(fields.get('title') || '').trim()
    const category = document.getElementById('rag-item-category')
    const payload = {
      title,
      text: String(fields.get('text') || '').trim(),
      categoryCode: String(fields.get('categoryCode') || ''),
      riskSignals: String(fields.get('riskSignals') || ''),
      keyPhrases: String(fields.get('keyPhrases') || ''),
      piiConfirmed: fields.get('piiConfirmed') === 'on',
    }
    busy = true
    submitButton.disabled = true
    body.classList.add('rag-manager-indexing')
    setStatus('正在生成 512 维向量', '使用 BAAI/bge-small-zh-v1.5 在本机计算并归一化', 'working')
    try {
      const data = await requestJson(ITEMS_PATH, { method: 'POST', body: JSON.stringify(payload) })
      updateReadiness({
        ready: true,
        knowledgeBaseVersion: data.knowledge_base_version,
        textCount: data.text_count,
        vectorCount: data.vector_count,
        embeddingDimension: data.embedding_dimension,
      })
      setStatus('新增数据已完成索引', `${formatCount(data.vector_count)} 条向量现在可被反诈检索调用`, 'success')
      addRecent(data, title, category?.selectedOptions?.[0]?.textContent || payload.categoryCode)
      form.reset()
      if (counter) counter.textContent = '0 / 8000'
    } catch (error) {
      setStatus('新增数据失败', error?.message || '请检查输入与 RAG 服务', 'error')
    } finally {
      busy = false
      submitButton.disabled = false
      body.classList.remove('rag-manager-indexing')
    }
  }

  textInput?.addEventListener('input', () => {
    if (counter) counter.textContent = `${textInput.value.length} / 8000`
  })
  form?.addEventListener('submit', event => void submit(event))
  document.getElementById('rag-manager-close')?.addEventListener('click', close)
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape' && body.classList.contains('rag-manager-mode')) close()
  })

  return { open, close, refresh }
}
