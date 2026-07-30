const RISK_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 }

export function createFraudMapStore() {
  const state = {
    snapshot: null,
    cases: [],
    selectedProvinceCode: '',
    selectedCaseId: '',
    recentPulses: [],
    lastError: '',
    lastReconciledAt: '',
  }
  const listeners = new Set()

  function notify() {
    for (const listener of listeners) listener(getState())
  }

  function getState() {
    return {
      ...state,
      snapshot: state.snapshot ? { ...state.snapshot, provinces: [...state.snapshot.provinces] } : null,
      cases: [...state.cases],
      recentPulses: [...state.recentPulses],
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      listener(getState())
      return () => listeners.delete(listener)
    },
    getState,
    setSnapshot(snapshot) {
      state.snapshot = snapshot
      state.lastReconciledAt = snapshot?.generatedAt || new Date().toISOString()
      state.lastError = ''
      notify()
    },
    setCases(items) {
      state.cases = Array.isArray(items) ? items : []
      notify()
    },
    selectProvince(provinceCode) {
      state.selectedProvinceCode = provinceCode || ''
      notify()
    },
    selectCase(caseId) {
      state.selectedCaseId = caseId || ''
      const item = state.cases.find(row => row.caseId === caseId)
      if (item) {
        state.selectedProvinceCode = item.provinceCode
        state.recentPulses = [item]
      }
      notify()
    },
    addCase(item) {
      if (!item?.caseId || state.cases.some(row => row.caseId === item.caseId)) return false
      state.cases = [item, ...state.cases].slice(0, 100)
      state.recentPulses = [item, ...state.recentPulses.filter(row => row.caseId !== item.caseId)].slice(0, 50)
      notify()
      return true
    },
    setError(error) {
      state.lastError = error?.message || String(error || '')
      notify()
    },
    clearPulses() {
      state.recentPulses = []
      notify()
    },
  }
}

export function provinceRiskValue(row) {
  if (!row) return 0
  return Number(row.caseCount || 0) + Number(row.highRiskCount || 0) * 2
}

export function riskColor(riskLevel) {
  return ({ low: '#4f8cff', medium: '#ffbe6b', high: '#ff7b72', critical: '#ff3d71' })[riskLevel] || '#a2adbd'
}

export function compareRisk(a, b) {
  return (RISK_WEIGHT[b?.riskLevel] || 0) - (RISK_WEIGHT[a?.riskLevel] || 0)
}
