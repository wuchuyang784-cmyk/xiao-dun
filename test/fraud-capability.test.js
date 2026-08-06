import assert from 'node:assert/strict'
import test from 'node:test'

import { capabilityToolsFor, findCapabilitiesByQuery } from '../src/capabilities/capability-registry.js'
import { getToolSchemas } from '../src/capabilities/schemas.js'

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
