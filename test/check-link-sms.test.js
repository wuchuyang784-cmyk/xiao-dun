// QA verification tests for the two new capabilities:
//   - check_link  (src/capabilities/tools/check-link.js)
//   - check_sms   (src/capabilities/tools/check-sms.js)
//
// Coverage:
//   1. check_link local heuristics (typosquat / bare IP / shortener / suspicious TLD /
//      userinfo / induce words / IDN-punycode / safe / invalid)
//   2. check_sms rule-engine matching + URL extraction
//   3. Degradation: RAG down (global fetch throws) -> check_sms still ok:true
//   4. Degradation: LLM unavailable (mocked callLLM throws) -> check_link &
//      check_sms still ok:true, no crash
//   5. exec* entry points return well-formed JSON with ok flag
//
// Run: node --test test/check-link-sms.test.js   (from repo root)

import assert from 'node:assert/strict'
import test, { mock } from 'node:test'

import { analyzeUrl, execCheckLink, CHECK_LINK_VERSION } from '../src/capabilities/tools/check-link.js'
import { runCheckSms, execCheckSms, CHECK_SMS_VERSION } from '../src/capabilities/tools/check-sms.js'

const llmPath = new URL('../src/llm.js', import.meta.url).href

const hasType = (findings, type) => findings.some(f => f.type === type)
const severities = (findings, type) => findings.filter(f => f.type === type).map(f => f.severity)

// ---------------------------------------------------------------------------
// check_link: local heuristics
// ---------------------------------------------------------------------------

test('check_link: safe well-known URL => 安全, no critical findings', async () => {
  const r = await analyzeUrl('https://www.baidu.com')
  assert.equal(r.ok, true)
  assert.equal(r.risk_level, '安全')
  assert.equal(r.risk_score, 0)
  assert.equal(r.findings.length, 0)
})

test('check_link: typosquatting of brand domain => brand_impersonation (high)', async () => {
  const r = await analyzeUrl('https://taobaoo.com/login')
  assert.equal(r.ok, true)
  assert.ok(hasType(r.findings, 'brand_impersonation'), 'expected brand_impersonation finding')
  assert.deepEqual(severities(r.findings, 'brand_impersonation'), ['high'])
  assert.ok(r.risk_score >= 35)
})

test('check_link: bare IPv4 + plain http => bare_ip + plain_http', async () => {
  const r = await analyzeUrl('http://192.168.1.1/login')
  assert.equal(r.ok, true)
  assert.ok(hasType(r.findings, 'bare_ip'))
  assert.ok(hasType(r.findings, 'plain_http'))
  assert.deepEqual(severities(r.findings, 'bare_ip'), ['high'])
})

test('check_link: URL shortener => shortener (medium)', async () => {
  const r = await analyzeUrl('https://t.cn/abc')
  assert.equal(r.ok, true)
  assert.ok(hasType(r.findings, 'shortener'))
  assert.deepEqual(severities(r.findings, 'shortener'), ['medium'])
})

test('check_link: suspicious TLD .tk => suspicious_tld (medium)', async () => {
  const r = await analyzeUrl('https://free-prize.tk/')
  assert.equal(r.ok, true)
  assert.ok(hasType(r.findings, 'suspicious_tld'))
  assert.deepEqual(severities(r.findings, 'suspicious_tld'), ['medium'])
})

test('check_link: userinfo in URL => userinfo (high)', async () => {
  const r = await analyzeUrl('https://admin@evil.com/')
  assert.equal(r.ok, true)
  assert.ok(hasType(r.findings, 'userinfo'))
  assert.deepEqual(severities(r.findings, 'userinfo'), ['high'])
})

test('check_link: induce words in path/query => induce_words', async () => {
  const r = await analyzeUrl('https://site.com/verify/login?account=reset')
  assert.equal(r.ok, true)
  assert.ok(hasType(r.findings, 'induce_words'))
})

test('check_link: IDN homoglyph domain => punycode/idn finding', async () => {
  // а(cyrillic) р р ӏ(cyrillic l) е  -> punycoded by URL constructor
  const r = await analyzeUrl('https://аррӏе.com/')
  assert.equal(r.ok, true)
  assert.ok(hasType(r.findings, 'idn'), 'expected idn/punycode finding for IDN domain')
})

test('check_link: empty input => ok:false with error', async () => {
  const r = await analyzeUrl('')
  assert.equal(r.ok, false)
  assert.ok(r.error)
})

test('check_link: non-URL garbage => ok:false (graceful)', async () => {
  const r = await analyzeUrl('this is not a url at all')
  assert.equal(r.ok, false)
  assert.ok(r.report)
})

test('check_link: report and advice are present strings', async () => {
  const r = await analyzeUrl('http://1.2.3.4/verify')
  assert.equal(typeof r.report, 'string')
  assert.ok(r.report.length > 0)
  assert.ok(Array.isArray(r.advice))
  assert.ok(r.advice.length > 0)
})

// ---------------------------------------------------------------------------
// check_sms: rule engine + extraction
// ---------------------------------------------------------------------------

test('check_sms: empty input => ok:false empty_input', async () => {
  const r = await runCheckSms('')
  assert.equal(r.ok, false)
  assert.equal(r.error, 'empty_input')
})

test('check_sms: scam SMS => rule engine hits + verdict + advice(96110)', async () => {
  const sms = '您的快递丢失了，客服让我加微信退款理赔，点链接填银行卡号和验证码领补偿'
  const r = await runCheckSms(sms)
  assert.equal(r.ok, true)
  assert.ok(r.rule_engine.hits.length >= 1, 'expected at least one rule hit')
  assert.ok(r.verdict.score > 0)
  assert.ok(['高风险', '中风险', '严重诈骗'].includes(r.verdict.level))
  assert.ok(r.advice.some(a => a.includes('96110')))
  assert.equal(typeof r.report, 'string')
  assert.ok(r.report.length > 0)
})

test('check_sms: extracts embedded URLs', async () => {
  const sms = '中奖了 http://192.168.1.1/claim 点击领取红包'
  const r = await runCheckSms(sms)
  assert.equal(r.ok, true)
  assert.ok(r.links.length >= 1)
  assert.ok(r.links.some(u => u.includes('192.168.1.1')))
})

// ---------------------------------------------------------------------------
// Degradation: RAG unavailable (global fetch throws) -> check_sms stays ok
// ---------------------------------------------------------------------------

test('check_sms: RAG down (fetch throws) degrades gracefully, still ok:true', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('RAG service unreachable') }
  try {
    const sms = '客服说快递丢失要退款理赔，点链接填验证码'
    const r = await runCheckSms(sms)
    assert.equal(r.ok, true, 'should not crash when RAG is down')
    assert.equal(r.rag.ok, false)
    assert.ok(r.rag.error)
    // rule engine conclusion must still be present
    assert.ok(r.rule_engine.hits.length >= 1)
    assert.ok(Array.isArray(r.advice) && r.advice.length > 0)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// ---------------------------------------------------------------------------
// Degradation: LLM unavailable (mocked callLLM throws) -> no crash
// ---------------------------------------------------------------------------

// mock.module needs the Node 22.x flag --experimental-test-module-mocks.
// We use it when available to force callLLM to throw; otherwise we fall back to
// the real client (which also throws when no model is configured) and just assert
// the result never breaks. Either way the degradation contract holds.
const canMockLlm = typeof mock?.module === 'function'

test('check_link: LLM layer never breaks the result (degradation)', async () => {
  if (canMockLlm) {
    mock.module(llmPath, {
      namedExports: { callLLM: async () => { throw new Error('LLM client unavailable') } },
    })
  }
  try {
    const r = await analyzeUrl('https://taobaoo.com/login', { llm: true })
    assert.equal(r.ok, true, 'LLM layer must never break the local verdict')
    assert.ok(hasType(r.findings, 'brand_impersonation'), 'local heuristics intact')
    if (canMockLlm) {
      assert.equal(r.llm_analysis, null)
      assert.ok(r.llm_note && r.llm_note.includes('降级'), 'expected degradation note')
    }
  } finally {
    if (canMockLlm) mock.reset()
  }
})

test('check_sms: LLM layer never breaks the result (degradation)', async () => {
  if (canMockLlm) {
    mock.module(llmPath, {
      namedExports: { callLLM: async () => { throw new Error('LLM client unavailable') } },
    })
  }
  try {
    const sms = '您的快递丢失了，客服让我加微信退款理赔，点链接填银行卡号和验证码领补偿'
    const r = await runCheckSms(sms, { llm: true })
    assert.equal(r.ok, true, 'LLM layer must never break the verdict')
    assert.ok(r.rule_engine.hits.length >= 1, 'rule conclusion intact')
    if (canMockLlm) {
      assert.equal(r.llm_analysis, null)
      assert.ok(r.llm_note && r.llm_note.includes('降级'), 'expected degradation note')
    }
  } finally {
    if (canMockLlm) mock.reset()
  }
})

// ---------------------------------------------------------------------------
// exec* entry points return well-formed JSON
// ---------------------------------------------------------------------------

test('execCheckLink returns JSON with ok:true and findings', async () => {
  const out = await execCheckLink({ url: 'http://1.2.3.4/login' })
  assert.equal(typeof out, 'string')
  const parsed = JSON.parse(out)
  assert.equal(parsed.ok, true)
  assert.ok(parsed.tool === 'check_link')
  assert.ok(Array.isArray(parsed.findings))
})

test('execCheckSms returns JSON with ok:true', async () => {
  const out = await execCheckSms({ text: '退款理赔 验证码 银行卡 链接 客服' })
  assert.equal(typeof out, 'string')
  const parsed = JSON.parse(out)
  assert.equal(parsed.ok, true)
  assert.ok(parsed.tool === 'check_sms')
  assert.ok(Array.isArray(parsed.advice))
})

test('execCheckSms empty returns JSON ok:false', async () => {
  const out = await execCheckSms({ text: '' })
  const parsed = JSON.parse(out)
  assert.equal(parsed.ok, false)
  assert.equal(parsed.error, 'empty_input')
})

test('version exports are present', () => {
  assert.equal(typeof CHECK_LINK_VERSION, 'string')
  assert.equal(typeof CHECK_SMS_VERSION, 'string')
})
