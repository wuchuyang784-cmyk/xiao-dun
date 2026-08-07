import { apiUrl } from './api-client.js'

const RECORDS_PATH = '/api/v1/analysis-records'
const RECORD_STATS_PATH = '/api/v1/analysis-records/stats'

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

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function normalizeFilters(form) {
  const fields = new FormData(form)
  return {
    analysisKind: String(fields.get('analysisKind') || '').trim(),
    riskLevel: String(fields.get('riskLevel') || '').trim(),
    toolName: String(fields.get('toolName') || '').trim(),
    analysisStatus: String(fields.get('analysisStatus') || '').trim(),
    dateFrom: String(fields.get('dateFrom') || '').trim(),
    dateTo: String(fields.get('dateTo') || '').trim(),
    keyword: String(fields.get('keyword') || '').trim(),
    page: 1,
    pageSize: 20,
  }
}

function makeQuery(filters = {}) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filters)) {
    if (value !== '' && value != null) params.set(key, String(value))
  }
  return params.toString()
}

function kindLabel(kind = '') {
  if (kind === 'image') return '\u56fe\u7247'
  if (kind === 'sms') return '\u77ed\u4fe1/\u804a\u5929'
  if (kind === 'link') return '\u94fe\u63a5'
  return '\u672a\u5206\u7c7b'
}

function statusLabel(status = '') {
  if (status === 'done') return '\u5df2\u5b8c\u6210'
  if (status === 'partial') return '\u90e8\u5206\u5b8c\u6210'
  if (status === 'failed') return '\u5931\u8d25'
  return '\u672a\u77e5'
}

function riskLabel(risk = '') {
  if (risk === 'critical') return '\u4e25\u91cd'
  if (risk === 'high') return '\u9ad8\u98ce\u9669'
  if (risk === 'medium') return '\u4e2d\u98ce\u9669'
  if (risk === 'low') return '\u4f4e\u98ce\u9669'
  return '\u672a\u77e5'
}

function toolLabel(tool = '') {
  if (tool === 'analyze_fraud_image') return '\u56fe\u7247\u5206\u6790'
  if (tool === 'check_sms') return '\u77ed\u4fe1/\u804a\u5929\u68c0\u6d4b'
  if (tool === 'check_link') return '\u94fe\u63a5\u68c0\u6d4b'
  return tool || '\u672a\u77e5\u5de5\u5177'
}

function formatTime(value = '') {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('zh-CN', { hour12: false })
}

function renderRecordDetail(record) {
  if (!record) return '\u5c1a\u672a\u9009\u62e9\u8bb0\u5f55\u3002'
  const parts = [
    `\u8bb0\u5f55ID\uff1a${record.recordId || '-'}`,
    `\u521b\u5efa\u65f6\u95f4\uff1a${formatTime(record.createdAt)}`,
    `\u5206\u6790\u7c7b\u578b\uff1a${kindLabel(record.analysisKind)} / ${toolLabel(record.toolName)}`,
    `\u98ce\u9669\u7b49\u7ea7\uff1a${riskLabel(record.riskLevel)} / \u72b6\u6001\uff1a${statusLabel(record.analysisStatus)}`,
    `\u8bc8\u9a97\u7c7b\u578b\uff1a${record.fraudType || '-'}`,
    `\u6765\u6e90\uff1a${record.source || '-'}`,
    `\u5bf9\u8c61\uff1a${record.subjectRef || '-'}`,
    '',
    `\u6458\u8981\uff1a${record.inputSummary || '-'}`,
    '',
    `\u5206\u6790\u62a5\u544a\uff1a${record.reportMarkdown || '-'}`,
  ]
  if (record.failureReason) {
    parts.push('', `\u5931\u8d25/\u90e8\u5206\u5b8c\u6210\u539f\u56e0\uff1a${record.failureReason}`)
  }
  return parts.join('\n')
}

function setText(id, value) {
  const node = document.getElementById(id)
  if (node) node.textContent = value
}

export function initRecordCenter({ openChat, closeHotspot, closeRagManager } = {}) {
  const body = document.body
  const panel = document.getElementById('record-center-panel')
  const form = document.getElementById('record-center-form')
  const list = document.getElementById('record-center-list')
  const detail = document.getElementById('record-center-detail')
  const live = document.getElementById('record-center-live')
  const status = document.getElementById('record-center-status')
  const resetButton = document.getElementById('record-center-reset')

  let busy = false
  let currentFilters = form ? normalizeFilters(form) : { page: 1, pageSize: 20 }
  let currentRecords = []
  let selectedRecordId = ''

  function setStatus(title, message, state = '') {
    if (!status) return
    status.className = `record-center-status ${state}`.trim()
    status.innerHTML = '<b></b><span></span>'
    status.querySelector('b').textContent = title
    status.querySelector('span').textContent = message
  }

  function updateStats(stats = {}) {
    const kinds = Array.isArray(stats.byKind) ? stats.byKind.filter((item) => item.analysisKind) : []
    setText('record-center-total-count', formatCount(stats.total))
    setText('record-center-today-count', formatCount(stats.today))
    setText('record-center-high-count', formatCount(stats.highRisk))
    setText('record-center-kind-count', formatCount(kinds.length))
  }

  function selectRecord(recordId) {
    selectedRecordId = recordId || ''
    const selected = currentRecords.find((record) => record.recordId === selectedRecordId) || null
    if (detail) detail.textContent = renderRecordDetail(selected)
    list?.querySelectorAll('.record-recent-row').forEach((node) => {
      node.classList.toggle('active', node.dataset.recordId === selectedRecordId)
    })
  }

  function renderList(data = {}) {
    currentRecords = Array.isArray(data.records) ? data.records : []
    setText('record-center-subtitle', `${formatCount(data.total || currentRecords.length)} \u6761`)
    if (!list) return
    if (!currentRecords.length) {
      list.innerHTML = '<div class="record-recent-empty">\u6ca1\u6709\u5339\u914d\u7684\u5907\u6848\u8bb0\u5f55</div>'
      selectRecord('')
      return
    }
    list.innerHTML = currentRecords.map((record) => `
      <button class="record-recent-row" type="button" data-record-id="${escapeHtml(record.recordId || '')}">
        <i class="risk-${escapeHtml(record.riskLevel || 'low')}"></i>
        <div>
          <b>${escapeHtml(record.inputSummary || record.fraudType || record.recordId || '\u672a\u547d\u540d\u8bb0\u5f55')}</b>
          <span>${escapeHtml(kindLabel(record.analysisKind))} ? ${escapeHtml(riskLabel(record.riskLevel))} ? ${escapeHtml(formatTime(record.createdAt))}</span>
        </div>
        <em>${escapeHtml(statusLabel(record.analysisStatus))}</em>
      </button>
    `).join('')
    selectRecord(currentRecords.some((item) => item.recordId === selectedRecordId) ? selectedRecordId : currentRecords[0]?.recordId)
  }

  async function refresh(filters = currentFilters) {
    if (busy) return
    busy = true
    if (live) live.innerHTML = '<i></i>LOADING'
    setStatus('\u6b63\u5728\u52a0\u8f7d\u5907\u6848\u8bb0\u5f55', '\u4ece\u672c\u5730 SQLite \u67e5\u8be2\u6700\u8fd1\u5206\u6790\u8bb0\u5f55', 'working')
    try {
      const [stats, data] = await Promise.all([
        requestJson(RECORD_STATS_PATH),
        requestJson(`${RECORDS_PATH}?${makeQuery(filters)}`),
      ])
      updateStats(stats)
      renderList(data)
      if (live) { live.classList.remove('error'); live.innerHTML = '<i></i>ONLINE' }
      setStatus('\u5907\u6848\u8bb0\u5f55\u5df2\u52a0\u8f7d', `\u5f53\u524d\u7b5b\u9009\u8fd4\u56de ${formatCount(data.total)} \u6761\u8bb0\u5f55`, 'success')
    } catch (error) {
      if (live) { live.classList.add('error'); live.innerHTML = '<i></i>ERROR' }
      setStatus('\u5907\u6848\u8bb0\u5f55\u52a0\u8f7d\u5931\u8d25', error?.message || '\u8bf7\u68c0\u67e5 API \u670d\u52a1', 'error')
    } finally {
      busy = false
    }
  }

  async function open() {
    closeHotspot?.()
    closeRagManager?.()
    body.classList.remove('video-mode', 'image-mode', 'doc-panel-mode')
    body.classList.add('record-center-mode')
    openChat?.()
    requestAnimationFrame(() => panel?.classList.add('active'))
    await refresh(currentFilters)
  }

  function close() {
    if (busy) return
    panel?.classList.remove('active')
    body.classList.remove('record-center-mode')
  }

  form?.addEventListener('submit', (event) => {
    event.preventDefault()
    currentFilters = normalizeFilters(form)
    void refresh(currentFilters)
  })
  resetButton?.addEventListener('click', () => {
    form?.reset()
    currentFilters = form ? normalizeFilters(form) : { page: 1, pageSize: 20 }
    void refresh(currentFilters)
  })
  list?.addEventListener('click', (event) => {
    const row = event.target?.closest?.('.record-recent-row')
    if (row) selectRecord(row.dataset.recordId || '')
  })
  document.getElementById('record-center-close')?.addEventListener('click', close)
  window.addEventListener('analysis_record_created', () => {
    if (body.classList.contains('record-center-mode')) void refresh(currentFilters)
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && body.classList.contains('record-center-mode')) close()
  })

  return { open, close, refresh }
}
