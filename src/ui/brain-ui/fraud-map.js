import { fetchChinaGeoJson, fetchFraudCases, fetchFraudSnapshot } from './fraud-map-data.js'
import { createFraudMapStore, provinceRiskValue } from './fraud-map-store.js'

// 读取当前主题 CSS 变量，让地图配色跟随主题变化
function readThemeVars() {
  const style = getComputedStyle(document.body)
  const pick = (name, fallback) => (style.getPropertyValue(name).trim() || fallback)
  return {
    low: pick('--map-low', '#142b4a'),
    mid: pick('--map-mid', '#1d5f79'),
    high: pick('--map-high', '#ffbe6b'),
    area: pick('--map-area', '#142437'),
    border: pick('--map-border', 'rgba(130, 180, 224, 0.44)'),
    hover: pick('--map-hover', '#286d91'),
    selected: pick('--map-selected', '#ff9f1c'),
    selectedBorder: pick('--map-selected-border', '#ffe4a3'),
    pulse: pick('--map-pulse', '#ff9f1c'),
    riskLow: pick('--map-risk-low', '#4f8cff'),
    riskMedium: pick('--map-risk-medium', '#ffbe6b'),
    riskHigh: pick('--map-risk-high', '#ff7b72'),
    riskCritical: pick('--map-risk-critical', '#ff3d71'),
    riskUnknown: pick('--map-risk-unknown', '#a2adbd'),
  }
}

function riskColor(level, vars) {
  return ({ low: vars.riskLow, medium: vars.riskMedium, high: vars.riskHigh, critical: vars.riskCritical })[level] || vars.riskUnknown
}

const SNAPSHOT_RECONCILE_INTERVAL_MS = 60 * 60 * 1000
const PULSE_TTL_MS = 60 * 1000
const MAX_VISIBLE_PULSES = 50

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char])
}

function formatMoney(value) {
  const amount = Number(value) || 0
  return `¥${amount.toLocaleString('zh-CN', { maximumFractionDigits: 0 })}`
}

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '--' : date.toLocaleString('zh-CN', { hour12: false })
}

function riskLabel(level) {
  return ({ low: '低风险', medium: '中风险', high: '高风险', critical: '严重风险' })[level] || '待评估'
}

function getMapValue(row) {
  return provinceRiskValue(row)
}

function createMapOptions(state) {
  const provinces = state.snapshot?.provinces || []
  const isSimulated = state.snapshot?.isSimulated === true
  const maxValue = Math.max(10, ...provinces.map(getMapValue))
  const selected = state.selectedProvinceCode
  const selectedName = provinces.find(item => item.provinceCode === selected)?.provinceName
  const visiblePulses = state.recentPulses
    .filter(item => Date.now() - Date.parse(item.occurredAt) <= PULSE_TTL_MS)
    .slice(0, MAX_VISIBLE_PULSES)
  const v = readThemeVars()

  return {
    animationDurationUpdate: 0,
    backgroundColor: 'transparent',
    tooltip: {
      trigger: 'item',
      formatter(params) {
        if (params.seriesType === 'effectScatter' || params.seriesType === 'scatter') {
          const item = params.data?.case || params.data
          return `<strong>${escapeHtml(item?.provinceName || params.name || '案件')}</strong><br>${escapeHtml(item?.fraudType || '')}<br>风险：${escapeHtml(riskLabel(item?.riskLevel))}<br>损失：${formatMoney(item?.lossAmount)}`
        }
        const row = provinces.find(item => item.provinceName === params.name)
        if (isSimulated) {
          return `<strong>${escapeHtml(params.name || '未知省份')}</strong><br>模拟样本：${row?.sampleCount || 0}<br><span style="color:${v.high}">比赛模拟数据 · 非真实案发率</span>`
        }
        return `<strong>${escapeHtml(params.name || '未知省份')}</strong><br>案件：${row?.caseCount || 0}<br>高风险：${row?.highRiskCount || 0}<br>待复核：${row?.pendingCount || 0}`
      },
    },
    visualMap: {
      min: 0,
      max: maxValue,
      show: false,
      calculable: false,
      inRange: { color: [v.low, v.mid, v.high, v.riskHigh, v.riskCritical] },
      seriesIndex: 0,
    },
    geo: {
      map: 'china',
      roam: false,
      silent: false,
      selectedMode: false,
      center: [104, 28.7],
      layoutCenter: ['50%', '50%'],
      layoutSize: '95%',
      zoom: 1,
      scaleLimit: { min: 1, max: 1 },
      aspectScale: 0.92,
      label: { show: false },
      itemStyle: {
        areaColor: v.area,
        borderColor: v.border,
        borderWidth: 0.8,
      },
      emphasis: {
        label: { show: true, color: v.high, fontSize: 11 },
        itemStyle: { areaColor: v.hover },
      },
      regions: selectedName ? [{ name: selectedName, itemStyle: { areaColor: v.selected, borderColor: v.selectedBorder, borderWidth: 1.5 } }] : [],
    },
    series: [
      {
        name: isSimulated ? 'RAG 模拟样本' : '诈骗案件',
        type: 'map',
        map: 'china',
        geoIndex: 0,
        data: provinces.map(row => ({ name: row.provinceName, value: getMapValue(row), province: row })),
        animation: false,
        emphasis: { label: { show: true } },
      },
      {
        name: '新增案件',
        type: 'effectScatter',
        coordinateSystem: 'geo',
        zlevel: 2,
        rippleEffect: { brushType: 'stroke', scale: 4 },
        symbolSize: item => Math.min(20, 8 + Math.sqrt(Number(item[2]) || 0) / 18),
        itemStyle: { color: item => riskColor(item.data?.case?.riskLevel, v), shadowBlur: 12, shadowColor: v.pulse },
        data: visiblePulses.map(item => ({
          name: item.caseId,
          value: [item.longitude, item.latitude, item.lossAmount],
          case: item,
        })),
      },
      {
        name: '重点案件',
        type: 'scatter',
        coordinateSystem: 'geo',
        zlevel: 3,
        symbolSize: 7,
        itemStyle: { color: item => riskColor(item.data?.case?.riskLevel, v), borderColor: v.area, borderWidth: 0.5 },
        data: state.cases
          .filter(item => ['high', 'critical'].includes(item.riskLevel))
          .slice(0, 40)
          .map(item => ({ name: item.caseId, value: [item.longitude, item.latitude, item.lossAmount], case: item })),
      },
    ],
  }
}

function renderRightPanel(state) {
  const root = document.getElementById('fraud-right-summary')
  if (!root) return
  const row = state.snapshot?.provinces?.find(item => item.provinceCode === state.selectedProvinceCode)
  const isSimulated = state.snapshot?.isSimulated === true
  const provinces = [...(state.snapshot?.provinces || [])].sort((a, b) => provinceRiskValue(b) - provinceRiskValue(a)).slice(0, 5)
  const title = isSimulated
    ? (row ? `${row.provinceName}模拟样本分布` : '全国 RAG 模拟分布')
    : (row ? `${row.provinceName}风险概览` : '全国风险概览')
  const total = row || provinces.reduce((acc, item) => ({
    caseCount: acc.caseCount + item.caseCount,
    highRiskCount: acc.highRiskCount + item.highRiskCount,
    pendingCount: acc.pendingCount + item.pendingCount,
    totalLossAmount: acc.totalLossAmount + item.totalLossAmount,
  }), { caseCount: 0, highRiskCount: 0, pendingCount: 0, totalLossAmount: 0 })
  root.innerHTML = `
    <div class="fraud-summary-title">${escapeHtml(title)}</div>
    <div class="fraud-risk-grid">
      ${isSimulated ? `
        <span><b>${row?.sampleCount ?? state.snapshot?.totalSamples ?? 0}</b><small>模拟样本</small></span>
        <span><b>${state.snapshot?.provinces?.length || 0}</b><small>省级区域</small></span>
        <span><b>RAG</b><small>数据来源</small></span>
        <span><b>DEMO</b><small>数据性质</small></span>
      ` : `
        <span><b>${total.caseCount || 0}</b><small>案件</small></span>
        <span><b class="fraud-risk-high-text">${total.highRiskCount || 0}</b><small>高风险</small></span>
        <span><b>${total.pendingCount || 0}</b><small>待复核</small></span>
        <span><b>${formatMoney(total.totalLossAmount)}</b><small>损失金额</small></span>
      `}
    </div>
    ${isSimulated ? `<div class="fraud-simulation-disclaimer">${escapeHtml(state.snapshot?.disclaimer || '比赛模拟数据，不代表真实案件发生率。')}</div>` : ''}
    <div class="fraud-ranking-label">${isSimulated ? '模拟样本分布排行' : '风险省份排行'}</div>
    <div class="fraud-ranking-list">${provinces.map((item, index) => `<button class="fraud-ranking-row" data-fraud-province-code="${escapeHtml(item.provinceCode)}" type="button"><span>${index + 1}</span><strong>${escapeHtml(item.provinceName)}</strong><em>${provinceRiskValue(item)}</em></button>`).join('')}</div>`
}

function renderStatus(state) {
  const root = document.getElementById('fraud-map-status')
  if (!root) return
  const isSimulated = state.snapshot?.isSimulated === true
  const title = document.querySelector('.fraud-map-title')
  if (title) title.textContent = isSimulated ? '中国反诈 RAG 模拟分布' : '中国诈骗案例统计'
  root.textContent = state.lastError
    ? `地图数据异常：${state.lastError}`
    : isSimulated
      ? `比赛模拟数据 · 非真实案件发生率 · ${state.lastReconciledAt ? `同步 ${formatTime(state.lastReconciledAt)}` : '正在同步'}`
      : `每小时校准 · ${state.lastReconciledAt ? `上次同步 ${formatTime(state.lastReconciledAt)}` : '正在同步'}`
  root.dataset.error = state.lastError ? 'true' : 'false'
}

export function initFraudMap() {
  const stage = document.getElementById('map-stage')
  const chartRoot = document.getElementById('fraud-map-chart')
  if (!stage || !chartRoot) return { destroy() {} }

  const charting = globalThis.echarts
  const store = createFraudMapStore()
  let chart = null
  let mapReady = false
  let destroyed = false
  let reconcileTimer = null
  let pulseTimer = null
  let active = false
  const seenCases = new Set()

  function render(state) {
    renderRightPanel(state)
    renderStatus(state)
    if (!chart || !mapReady) return
    chart.setOption(createMapOptions(state), { notMerge: true, lazyUpdate: true })
  }

  async function reconcile({ throwOnError = false } = {}) {
    const controller = new AbortController()
    try {
      const snapshot = await fetchFraudSnapshot({ signal: controller.signal })
      const items = snapshot?.isSimulated
        ? []
        : await fetchFraudCases({ limit: 100, signal: controller.signal })
      if (destroyed) return
      store.setSnapshot(snapshot)
      store.setCases(items)
      items.forEach(item => seenCases.add(item.caseId))
      return snapshot
    } catch (error) {
      if (!destroyed) store.setError(error)
      if (throwOnError) throw error
      return null
    }
  }

  function onSseEvent(event) {
    if (!active) return
    const { type, data } = event.detail || {}
    if (type === 'fraud_case_created' && data?.caseId) {
      if (store.getState().snapshot?.isSimulated) return
      if (seenCases.has(data.caseId)) return
      seenCases.add(data.caseId)
      store.addCase(data)
      return
    }
    if (type === 'fraud_statistics_changed' || type === 'fraud_statistics_snapshot') {
      if (store.getState().snapshot?.isSimulated) void reconcile()
      else store.setSnapshot(data)
    }
  }

  function onCaseClick(caseId) {
    store.selectCase(caseId)
    const item = store.getState().cases.find(row => row.caseId === caseId)
    if (item && chart) {
      chart.dispatchAction({ type: 'showTip', seriesIndex: 1, name: item.caseId })
    }
  }

  function onProvinceClick(provinceCode) {
    store.selectProvince(provinceCode)
    if (store.getState().snapshot?.isSimulated) return
    void fetchFraudCases({ provinceCode, limit: 30 }).then(items => store.setCases(items)).catch(error => store.setError(error))
  }

  const onClick = event => {
    const target = event.target.closest('[data-fraud-case-id], [data-fraud-province-code]')
    if (!target) return
    if (target.dataset.fraudCaseId) onCaseClick(target.dataset.fraudCaseId)
    if (target.dataset.fraudProvinceCode) onProvinceClick(target.dataset.fraudProvinceCode)
  }

  stage.addEventListener('click', onClick)
  window.addEventListener('xiao-dun:sse-event', onSseEvent)
  const unsubscribe = store.subscribe(render)

  if (!charting) {
    store.setError(new Error('ECharts 未加载'))
  } else {
    chart = charting.init(chartRoot, null, { renderer: 'canvas' })
    chart.on('click', params => {
      if (params.seriesType === 'map') {
        const row = params.data?.province || store.getState().snapshot?.provinces?.find(item => item.provinceName === params.name)
        if (row?.provinceCode) onProvinceClick(row.provinceCode)
      } else if (params.data?.case?.caseId) {
        onCaseClick(params.data.case.caseId)
      }
    })
    void fetchChinaGeoJson().then(geoJson => {
      if (destroyed) return
      charting.registerMap('china', geoJson)
      mapReady = true
      // The China heatmap is the default view; fetch the external RAG snapshot immediately.
      void reconcile().then(() => render(store.getState())).catch(() => render(store.getState()))
    }).catch(error => store.setError(error))
  }

  pulseTimer = setInterval(() => {
    const state = store.getState()
    if (state.recentPulses.length) store.clearPulses()
  }, PULSE_TTL_MS)
  const resize = () => chart?.resize()
  window.addEventListener('resize', resize)

  return {
    store,
    reconcile,
    // 主题切换时调用，让 ECharts 用最新的 CSS 变量重绘
    refresh() {
      if (chart && mapReady) chart.setOption(createMapOptions(store.getState()), { notMerge: true, lazyUpdate: true })
    },
    destroy() {
      destroyed = true
      clearInterval(reconcileTimer)
      clearInterval(pulseTimer)
      stage.removeEventListener('click', onClick)
      window.removeEventListener('xiao-dun:sse-event', onSseEvent)
      window.removeEventListener('resize', resize)
      unsubscribe()
      chart?.dispose()
    },
  }
}
