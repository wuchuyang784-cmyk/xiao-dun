import assert from 'node:assert/strict'
import test from 'node:test'

import { capabilityToolsFor, findCapabilitiesByQuery } from '../src/capabilities/capability-registry.js'
import { getToolSchemas } from '../src/capabilities/schemas.js'
import { resolveExplicitCommand } from '../src/capabilities/intent-resolver.js'
import {
  execCheckQrcode,
  execSearchLaw,
} from '../src/capabilities/tools/fraud-toolkit.js'
import { execGetDailyTip } from '../src/capabilities/tools/daily-tip.js'

test('fraud-related messages activate the RAG search tool', () => {
  const tools = capabilityToolsFor({
    rawText: '帮我判断这段出售银行卡收款的话术是不是诈骗',
    text: '帮我判断这段出售银行卡收款的话术是不是诈骗',
  })
  assert.ok(tools.includes('search_fraud_cases'))
})

test('find_tool can discover the anti-fraud RAG capability', () => {
  const matches = findCapabilitiesByQuery('诈骗案例知识库')
  assert.ok(matches.some((item) => item.tools.includes('search_fraud_cases')))
})

test('search_fraud_cases has an LLM tool schema', () => {
  const schemas = getToolSchemas(['search_fraud_cases'])
  assert.equal(schemas.length, 1)
  assert.equal(schemas[0].function.name, 'search_fraud_cases')
})

test('dev4 anti-fraud commands route to their migrated capabilities', () => {
  const expected = new Map([
    ['/每日提醒', 'daily-tip'],
    ['/daily_tip', 'daily-tip'],
    ['/诈骗情报', 'fraud-intel'],
    ['/fraud_intel', 'fraud-intel'],
    ['/举报', 'fraud-toolkit'],
    ['/report_fraud', 'fraud-toolkit'],
    ['/查法规 诈骗罪', 'fraud-toolkit'],
    ['/search_law fraud', 'fraud-toolkit'],
    ['/查二维码 https://example.com', 'fraud-toolkit'],
    ['/check_qrcode https://example.com', 'fraud-toolkit'],
    ['/核实身份 13800138000', 'fraud-toolkit'],
    ['/verify_identity 13800138000', 'fraud-toolkit'],
  ])
  for (const [command, capability] of expected) {
    assert.equal(resolveExplicitCommand(command), capability, command)
  }
})

test('migrated anti-fraud capability exposes all five tool schemas', () => {
  const names = ['get_daily_tip', 'report_fraud', 'search_law', 'check_qrcode', 'verify_identity']
  assert.deepEqual(
    getToolSchemas(names).map(schema => schema.function.name),
    names,
  )
})

test('explicit daily-tip category is not overridden by live fraud intel', () => {
  const result = JSON.parse(execGetDailyTip({ date: '2026-08-06', category: 'drill' }))
  assert.equal(result.ok, true)
  assert.equal(result.tip.category, 'drill')
  assert.equal(result.source_type, 'seed')
})

test('law search uses the official article number and includes a legal disclaimer', () => {
  const result = JSON.parse(execSearchLaw({ query: '招摇撞骗' }))
  assert.equal(result.ok, true)
  assert.equal(result.results[0].article, '第279条 招摇撞骗罪')
  assert.match(result.results[0].official_url, /^https:\/\//)
  assert.match(result.disclaimer, /不构成法律意见/)
})

test('QR URL analysis distinguishes official subdomains from lookalike domains', () => {
  const official = JSON.parse(execCheckQrcode({ content: 'https://help.jd.com/login' }))
  const lookalike = JSON.parse(execCheckQrcode({ content: 'https://eviljd.com/login' }))

  assert.equal(official.risk_indicators.some(item => item.type === 'lookalike_domain'), false)
  assert.equal(lookalike.risk_indicators.some(item => item.type === 'lookalike_domain'), true)
})
