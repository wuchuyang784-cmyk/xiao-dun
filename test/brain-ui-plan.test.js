import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { createBrainUiMarkup } from '../src/ui/brain-ui/app-shell.js'
import { applyPlanEvent, createPlanState, getPlanProgress } from '../src/ui/brain-ui/plan-state.js'

const UI_DIR = new URL('../src/ui/brain-ui/', import.meta.url)
const readUiSource = (name) => readFileSync(fileURLToPath(new URL(name, UI_DIR)), 'utf8')

const MARKUP = createBrainUiMarkup()
const APP_TEXT = readUiSource('app.js')
const CSS_TEXT = readUiSource('styles.css')

test('执行规划待命态提供明确空状态，而不是空白区域', () => {
  assert.match(MARKUP, /id="plan-empty-state"/)
  assert.match(MARKUP, /暂无执行任务|待命/)
  assert.match(CSS_TEXT, /\.plan-empty-state/)
})

test('执行规划接入任务时间线事件并显示总体进度', () => {
  assert.match(APP_TEXT, /task_set/)
  assert.match(APP_TEXT, /task_step_updated/)
  assert.match(APP_TEXT, /task_cleared/)
  assert.match(APP_TEXT, /planProgress|plan-progress/)
})

test('执行规划保留外部 RAG 工具作为步骤详情，而不是内部兜底', () => {
  assert.match(APP_TEXT, /search_fraud_cases/)
  assert.match(APP_TEXT, /外部 RAG|RAG/)
  assert.match(CSS_TEXT, /\.plan-tool-detail/)
})


test('???????????????????', () => {
  let state = createPlanState()
  state = applyPlanEvent(state, {
    type: 'message_received',
    data: { input: '\u5206\u6790\u77ed\u4fe1\u98ce\u9669' },
  }, { now: 100 })
  state = applyPlanEvent(state, {
    type: 'task_set',
    data: {
      task: '\u5206\u6790\u77ed\u4fe1\u98ce\u9669',
      steps: ['\u8bc6\u522b\u7528\u6237\u95ee\u9898', '\u68c0\u7d22\u5916\u90e8 RAG \u5386\u53f2\u6848\u4f8b'],
    },
  }, { now: 120 })
  assert.equal(state.steps.length, 2)
  assert.deepEqual(getPlanProgress(state), {
    done: 0,
    total: 2,
    currentIndex: 0,
    percent: 0,
    label: '0 / 2',
  })

  state = applyPlanEvent(state, {
    type: 'task_step_updated',
    data: { index: 0, status: 'running', note: '\u5df2\u63d0\u53d6\u77ed\u4fe1\u6587\u672c' },
  }, { now: 200 })
  state = applyPlanEvent(state, {
    type: 'task_step_updated',
    data: { index: 0, status: 'done', note: '\u53ef\u7591\u8bcd\u6c47\u5df2\u6807\u8bb0' },
  }, { now: 400 })
  assert.equal(state.steps[0].status, 'done')
  assert.equal(state.steps[0].durationMs, 200)
  assert.equal(state.steps[0].note, '\u53ef\u7591\u8bcd\u6c47\u5df2\u6807\u8bb0')

  state = applyPlanEvent(state, {
    type: 'task_step_updated',
    data: { index: 1, status: 'running' },
  }, { now: 500 })
  state = applyPlanEvent(state, {
    type: 'tool_preparing',
    data: { name: 'search_fraud_cases' },
  }, { now: 600 })
  state = applyPlanEvent(state, {
    type: 'tool_executing',
    data: { name: 'search_fraud_cases' },
  }, { now: 700 })
  state = applyPlanEvent(state, {
    type: 'tool_call',
    data: { name: 'search_fraud_cases', ok: true },
  }, { now: 1000 })

  const tool = state.steps[1].tools[0]
  assert.equal(tool.name, 'search_fraud_cases')
  assert.equal(tool.status, 'done')
  assert.equal(tool.durationMs, 400)

  state = applyPlanEvent(state, {
    type: 'task_cleared',
    data: { summary: '\u5df2\u751f\u6210\u5904\u7f6e\u5efa\u8bae' },
  }, { now: 1200 })
  assert.equal(state.phase, 'complete')
  assert.equal(state.summary, '\u5df2\u751f\u6210\u5904\u7f6e\u5efa\u8bae')
  assert.equal(state.activeToolId, null)
})

test('???? tool_call ?????????', () => {
  let state = applyPlanEvent(createPlanState(), {
    type: 'task_set',
    data: { task: '\u68c0\u67e5', steps: ['\u6267\u884c\u68c0\u67e5'] },
  }, { now: 10 })
  state = applyPlanEvent(state, {
    type: 'tool_call',
    data: { name: 'search_fraud_cases', ok: false },
  }, { now: 20 })
  assert.equal(state.steps[0].tools.length, 1)
  assert.equal(state.steps[0].tools[0].status, 'failed')
  assert.equal(state.steps[0].tools[0].name, 'search_fraud_cases')
})

test('?????? error ??????????', () => {
  const state = applyPlanEvent(createPlanState(), {
    type: 'error',
    data: { error: '\u5916\u90e8 RAG \u4e0d\u53ef\u7528' },
  }, { now: 10 })
  assert.equal(state.phase, 'idle')
  assert.equal(state.error, '')
  assert.equal(state.steps.length, 0)
})
