const TERMINAL_STATUSES = new Set(['done', 'failed', 'skipped'])

export const PLAN_STATUS_LABELS = Object.freeze({
  pending: '等待中',
  running: '执行中',
  done: '已完成',
  failed: '失败',
  skipped: '已跳过',
})

export const PLAN_STATUS_ICONS = Object.freeze({
  pending: '○',
  running: '●',
  done: '✓',
  failed: '!',
  skipped: '—',
})

export function createPlanState() {
  return {
    phase: 'idle',
    title: '',
    startedAt: null,
    finishedAt: null,
    summary: '',
    error: '',
    steps: [],
    activeToolId: null,
    nextToolId: 1,
  }
}

function normalizeStatus(status) {
  const value = String(status || 'pending').toLowerCase()
  if (value === 'active' || value === 'in_progress' || value === 'processing') return 'running'
  if (value === 'complete' || value === 'completed' || value === 'success') return 'done'
  if (value === 'cancelled' || value === 'canceled') return 'skipped'
  return PLAN_STATUS_LABELS[value] ? value : 'pending'
}

function normalizeStep(raw, index) {
  const text = typeof raw === 'string'
    ? raw
    : raw?.text || raw?.name || raw?.label || `执行步骤 ${index + 1}`
  return {
    id: `step-${index}`,
    text: String(text),
    status: normalizeStatus(raw?.status),
    note: String(raw?.note || ''),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    tools: [],
  }
}

function isTerminal(status) {
  return TERMINAL_STATUSES.has(status)
}

function activeStepIndex(steps) {
  const running = steps.findIndex(step => step.status === 'running')
  if (running >= 0) return running
  return steps.findIndex(step => !isTerminal(step.status))
}

function updateStepTiming(step, status, now) {
  const next = { ...step, status }
  if (status === 'running' && next.startedAt == null) next.startedAt = now
  if (isTerminal(status)) {
    if (next.startedAt == null) next.startedAt = now
    next.finishedAt = now
    next.durationMs = Math.max(0, now - next.startedAt)
  }
  return next
}

function appendTool(state, name, status, now) {
  const toolName = String(name || 'tool')
  let steps = state.steps
  let index = activeStepIndex(steps)
  if (index < 0) {
    index = steps.length
    steps = [...steps, normalizeStep({ text: '执行工具', status: 'running' }, index)]
  }

  const tool = {
    id: `tool-${state.nextToolId}`,
    name: toolName,
    status,
    startedAt: now,
    finishedAt: null,
    durationMs: null,
  }
  steps = steps.map((step, stepIndex) => stepIndex === index
    ? { ...step, status: step.status === 'pending' ? 'running' : step.status, tools: [...step.tools, tool] }
    : step)

  return {
    ...state,
    steps,
    activeToolId: tool.id,
    nextToolId: state.nextToolId + 1,
  }
}

function updateActiveTool(state, status, now) {
  if (!state.activeToolId) return state
  let updated = false
  const steps = state.steps.map(step => ({
    ...step,
    tools: step.tools.map(tool => {
      if (tool.id !== state.activeToolId) return tool
      updated = true
      const next = { ...tool, status }
      if (status === 'running' && next.startedAt == null) next.startedAt = now
      if (isTerminal(status)) {
        if (next.startedAt == null) next.startedAt = now
        next.finishedAt = now
        next.durationMs = Math.max(0, now - next.startedAt)
      }
      return next
    }),
  }))
  return updated ? { ...state, steps, activeToolId: isTerminal(status) ? null : state.activeToolId } : state
}

export function applyPlanEvent(state, event, { now = Date.now() } = {}) {
  const current = state || createPlanState()
  const type = event?.type
  const data = event?.data || {}

  switch (type) {
    case 'message_received':
      return {
        ...createPlanState(),
        phase: 'active',
        title: String(data.input || data.content || '用户任务'),
        startedAt: now,
      }

    case 'task_set':
      return {
        ...current,
        phase: 'active',
        title: String(data.task || current.title || '执行任务'),
        startedAt: current.startedAt || now,
        finishedAt: null,
        summary: '',
        error: '',
        steps: Array.isArray(data.steps) ? data.steps.map(normalizeStep) : [],
        activeToolId: null,
        nextToolId: 1,
      }

    case 'task_step_updated': {
      const index = Number(data.index)
      if (!Number.isInteger(index) || !current.steps[index]) return current
      const status = normalizeStatus(data.status)
      const steps = current.steps.map((step, stepIndex) => stepIndex === index
        ? { ...updateStepTiming(step, status, now), note: String(data.note || '') }
        : step)
      return { ...current, phase: 'active', steps }
    }

    case 'tool_preparing':
      return appendTool(current, data.name, 'pending', now)

    case 'tool_executing':
      return current.activeToolId
        ? updateActiveTool(current, 'running', now)
        : appendTool(current, data.name, 'running', now)

    case 'tool_call': {
      const status = data.ok === false ? 'failed' : 'done'
      if (current.activeToolId) return updateActiveTool(current, status, now)
      return updateActiveTool(appendTool(current, data.name, status, now), status, now)
    }

    case 'task_cleared':
      return {
        ...current,
        phase: 'complete',
        finishedAt: now,
        summary: String(data.summary || ''),
        error: '',
        activeToolId: null,
      }

    case 'response':
      return current.phase === 'active'
        ? { ...current, phase: 'complete', finishedAt: now, activeToolId: null }
        : current

    case 'processing_preempted':
      return current.phase === 'active'
        ? { ...current, phase: 'failed', finishedAt: now, error: '执行已中断', activeToolId: null }
        : current

    case 'error':
      return current.phase === 'active'
        ? { ...current, phase: 'failed', finishedAt: now, error: String(data.error || '执行失败'), activeToolId: null }
        : current

    default:
      return current
  }
}

export function getPlanProgress(state) {
  const steps = Array.isArray(state?.steps) ? state.steps : []
  const total = steps.length
  const done = steps.filter(step => step.status === 'done' || step.status === 'skipped').length
  const current = activeStepIndex(steps)
  return {
    done,
    total,
    currentIndex: current,
    percent: total ? Math.round((done / total) * 100) : 0,
    label: total ? `${done} / ${total}` : '—',
  }
}

export function getPlanDurationMs(state) {
  if (!state?.startedAt) return null
  const end = state.finishedAt || Date.now()
  return Math.max(0, end - state.startedAt)
}
