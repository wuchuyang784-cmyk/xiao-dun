import assert from 'node:assert/strict'
import test from 'node:test'

import { createAnalysisRecord, getAnalysisRecord, listAnalysisRecords } from '../src/services/analysis-record-service.js'
import { execCheckSms } from '../src/capabilities/tools/check-sms.js'
import { execCheckLink } from '../src/capabilities/tools/check-link.js'
import { execAnalyzeFraudImage } from '../src/capabilities/tools/fraud-image.js'

test('analysis record service preserves extended fraud-analysis fields', () => {
  const recordId = `test-record-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const created = createAnalysisRecord({
    recordId,
    inputSummary: '测试摘要',
    inputHash: `hash-${recordId}`,
    fraudType: '短信诈骗',
    riskLevel: 'high',
    rulesHit: [{ id: 'rule-1', type: 'test' }],
    modelUsed: 'test-model',
    latencyMs: 123,
    alertSent: false,
    feedback: null,
    source: 'test',
    createdAt: new Date().toISOString(),
    analysisKind: 'sms',
    subjectKind: 'text',
    subjectRef: 'TEST_SMS_SUBJECT',
    toolName: 'check_sms',
    analysisStatus: 'done',
    failureReason: '',
    reportMarkdown: '测试报告',
  })

  assert.equal(created.analysisKind, 'sms')
  assert.equal(created.subjectKind, 'text')
  assert.equal(created.toolName, 'check_sms')
  assert.equal(created.analysisStatus, 'done')
  assert.equal(created.reportMarkdown, '测试报告')

  const loaded = getAnalysisRecord(recordId)
  assert.equal(loaded.analysisKind, 'sms')
  assert.equal(loaded.subjectKind, 'text')
  assert.equal(loaded.toolName, 'check_sms')
  assert.equal(loaded.analysisStatus, 'done')
  assert.equal(loaded.reportMarkdown, '测试报告')
})

test('analysis record service filters by analysis kind and tool name', () => {
  const recordId = `test-filter-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const keyword = `筛选关键词-${recordId}`
  createAnalysisRecord({
    recordId,
    inputSummary: keyword,
    inputHash: `hash-${recordId}`,
    fraudType: '链接诈骗',
    riskLevel: 'medium',
    rulesHit: [],
    modelUsed: 'test-model',
    source: 'test',
    createdAt: new Date().toISOString(),
    analysisKind: 'link',
    subjectKind: 'url',
    subjectRef: 'https://example.com',
    toolName: 'check_link',
    analysisStatus: 'done',
    reportMarkdown: 'report',
  })

  const result = listAnalysisRecords({
    analysisKind: 'link',
    toolName: 'check_link',
    keyword,
    page: 1,
    pageSize: 20,
  })

  assert.ok(result.records.some((item) => item.recordId === recordId))
  const item = result.records.find((row) => row.recordId === recordId)
  assert.equal(item.analysisKind, 'link')
  assert.equal(item.toolName, 'check_link')
})

test('check_sms writes an analysis record and returns its record id', async () => {
  const marker = `短信备案-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const output = JSON.parse(await execCheckSms({ text: `帮我看看这条短信是不是诈骗 ${marker}` }))
  assert.equal(output.ok, true)
  assert.ok(output.record_id)

  const record = getAnalysisRecord(output.record_id)
  assert.ok(record)
  assert.equal(record.analysisKind, 'sms')
  assert.equal(record.toolName, 'check_sms')
  assert.ok(['done', 'partial'].includes(record.analysisStatus))
})

test('check_link writes an analysis record and returns its record id', async () => {
  const marker = `link-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const output = JSON.parse(await execCheckLink({ url: `https://example.com/${marker}` }))
  assert.equal(output.ok, true)
  assert.ok(output.record_id)

  const record = getAnalysisRecord(output.record_id)
  assert.ok(record)
  assert.equal(record.analysisKind, 'link')
  assert.equal(record.toolName, 'check_link')
  assert.equal(record.analysisStatus, 'done')
})


test('analyze_fraud_image writes a failed analysis record when vision stage fails', async () => {
  const output = JSON.parse(await execAnalyzeFraudImage({
    image_path: 'missing-image-for-record-center-test.png',
    user_intent: 'check whether this screenshot is fraud',
  }))

  assert.equal(output.ok, false)
  assert.equal(output.tool, 'analyze_fraud_image')
  assert.ok(output.record_id)

  const record = getAnalysisRecord(output.record_id)
  assert.ok(record)
  assert.equal(record.analysisKind, 'image')
  assert.equal(record.toolName, 'analyze_fraud_image')
  assert.equal(record.analysisStatus, 'failed')
})
