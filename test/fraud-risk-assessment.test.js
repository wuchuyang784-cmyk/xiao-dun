import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildCaseReportTemplate,
  buildWechatReport,
  extractUrls,
  normalizeLlmSummary,
  normalizeLossStatus,
  runAssessFraudRisk,
} from '../src/capabilities/tools/fraud-risk-assessment.js'
import { getToolSchemas } from '../src/capabilities/schemas.js'
import { resolveExplicitCommand } from '../src/capabilities/intent-resolver.js'

const baseDeps = {
  runRule: async () => JSON.stringify({
    ok: true,
    score: 78,
    level: '高风险',
    hits: [{
      id: 'fake',
      type: '冒充客服',
      risk: 'high',
      score: 78,
      matchedKeywords: ['验证码', '退款'],
      signals: ['要求提供验证码'],
      playbook: [],
      advice: [],
    }],
  }),
  checkLink: async ({ url }) => JSON.stringify({
    ok: true,
    url,
    risk_score: url.includes('evil') ? 90 : 5,
    risk_level: url.includes('evil') ? '高风险' : '安全',
    findings: url.includes('evil') ? [{ type: 'phishing', message: '疑似钓鱼链接' }] : [],
  }),
  searchCases: async () => ({ items: [{ title: '冒充客服退款诈骗案例', score: 0.82, text: '要求验证码后转账。' }] }),
  getReadiness: async () => ({ ready: true, status: 'ready', textCount: 9975, vectorCount: 9975 }),
  webSearch: async () => JSON.stringify({ ok: false, error: 'not configured' }),
  callLLM: async () => ({ content: '证据显示对方以退款为由索要验证码，风险较高。' }),
}

test('slash aliases and schema route to the unified assessment', () => {
  assert.equal(resolveExplicitCommand('/risk_assess 可疑内容'), 'fraud-risk-assessment')
  assert.equal(resolveExplicitCommand('/风险研判 可疑内容'), 'fraud-risk-assessment')
  assert.equal(resolveExplicitCommand('/诈骗研判 可疑内容'), 'fraud-risk-assessment')
  assert.equal(getToolSchemas(['assess_fraud_risk'])[0].function.name, 'assess_fraud_risk')
})

test('text assessment checks rules, links, RAG, loss state, and LLM summary', async () => {
  const result = await runAssessFraudRisk({
    text: '/risk_assess 客服说退款，要求验证码 https://evil.example/login',
  }, {}, baseDeps)
  assert.equal(result.ok, true)
  assert.equal(result.risk.level, 'high')
  assert.equal(result.loss_status, 'unknown')
  assert.equal(result.links.checked.length, 1)
  assert.equal(result.similar_cases.length, 1)
  assert.match(result.report, /是否已经转账/)
  assert.match(result.report, /研判结论/)
})

test('confirmed loss escalates the banner and keeps WeChat plain text', async () => {
  const result = await runAssessFraudRisk({
    text: '我已经转账给对方，客服还要验证码',
    loss_status: 'confirmed',
  }, {}, baseDeps)
  assert.equal(result.risk.level, 'critical')
  assert.match(result.report, /紧急提醒/)
  assert.equal(result.case_report.generated, true)
  assert.match(result.case_report.text, /疑似电信网络诈骗案件情况说明/)
  assert.match(result.case_report.text, /待补充/)
  const wechat = buildWechatReport(result)
  assert.match(wechat, /96110/)
  assert.match(wechat, /报案材料草稿/)
  assert.doesNotMatch(wechat, /\|.*\|/)
  assert.ok(wechat.length <= 1800)
})

test('case report template only copies known facts and leaves missing fields pending', () => {
  const template = buildCaseReportTemplate({
    fraud_type: '冒充客服退款',
    links: { detected: ['https://evil.example/pay'] },
  }, {
    sourceText: '对方电话13800138000，要求转账368000元到6222021234567890123。',
    attachments: [{ path: '/tmp/chat.png' }],
    channel: 'WECHAT',
  })
  assert.match(template.text, /13800138000/)
  assert.match(template.text, /6222021234567890123/)
  assert.match(template.text, /368000元/)
  assert.match(template.text, /待补充/)
  assert.match(template.wechat_text, /报案材料草稿/)
})

test('authority impersonation requesting account passwords is critical even without upstream rules', async () => {
  const result = await runAssessFraudRisk({
    text: '公安打电话给我说我的账户有不明资金流动，需要我提供银行卡账户密码。',
  }, {}, {
    ...baseDeps,
    runRule: async () => JSON.stringify({ ok: true, score: 0, level: '无风险', hits: [], summary: '' }),
    checkLink: async () => JSON.stringify({ ok: true, risk_score: 0, findings: [] }),
    callLLM: null,
  })
  assert.equal(result.risk.level, 'high')
  assert.ok(result.risk.score >= 95)
  assert.match(result.fraud_type, /公检法/)
})

test('insurance auto-charge cancellation call is high risk without an upstream rule hit', async () => {
  const result = await runAssessFraudRisk({
    text: '我接到一个00开头号码的陌生电话，对方称我之前购买的保险服务快到期了，不取消的话每个月会扣费2000元，如需取消保险服务的话就需要按照对方所说的操作。',
  }, { currentChannel: 'API' }, {
    ...baseDeps,
    runRule: async () => JSON.stringify({ ok: true, score: 0, level: '无风险', hits: [], summary: '' }),
    checkLink: async () => JSON.stringify({ ok: true, risk_score: 0, findings: [] }),
    callLLM: null,
  })
  assert.equal(result.risk.level, 'high')
  assert.ok(result.risk.score >= 90)
  assert.match(result.fraud_type, /保险客服取消续费/)
  assert.match(result.report, /自动扣费施压/)
  assert.match(result.report, /研判结论/)
  assert.equal(result.case_report.generated, true)
  assert.match(result.case_report.text, /高风险诈骗线索/)
  assert.match(result.case_report.text, /损失：尚未确认/)
  assert.match(result.case_report.text, /通过网页端收到或发现可疑信息/)
  assert.match(buildWechatReport(result), /高风险报案材料草稿/)
})

test('bare recharge URL is extracted and raises a phishing-offer risk', async () => {
  const text = '我收到一条短信说9.9元话费充值券到账，1分钱可充10元话费，点击充值 dprul.cn/32wAYLya'
  assert.deepEqual(extractUrls(text), ['dprul.cn/32wAYLya'])
  const result = await runAssessFraudRisk({ text }, {}, {
    ...baseDeps,
    runRule: async () => JSON.stringify({ ok: true, score: 0, level: '无风险', hits: [], summary: '' }),
    checkLink: async ({ url }) => JSON.stringify({ ok: true, url, risk_score: 0, findings: [] }),
    callLLM: null,
  })
  assert.equal(result.links.checked[0].url, 'dprul.cn/32wAYLya')
  assert.equal(result.risk.level, 'high')
  assert.match(result.fraud_type, /充值/)
})

test('LLM tool-call JSON is not shown as a summary', () => {
  assert.equal(normalizeLlmSummary('{"target_id":"user","content":"综合判断：疑似钓鱼，请勿提供密码。"}'), '疑似钓鱼，请勿提供密码。')
  assert.equal(normalizeLlmSummary('send_message'), '')
  assert.equal(normalizeLlmSummary('send_message({ "target_id": "user", "content": "test" })'), '')
})

test('structured LLM triage can raise a missed social-engineering risk', async () => {
  const result = await runAssessFraudRisk({
    text: '对方让我安装一个客服应用后再办理取消服务。',
  }, {}, {
    ...baseDeps,
    runRule: async () => JSON.stringify({ ok: true, score: 0, level: '无风险', hits: [], summary: '' }),
    checkLink: async () => JSON.stringify({ ok: true, risk_score: 0, findings: [] }),
    callLLM: async () => ({
      content: JSON.stringify({
        risk_score: 76,
        fraud_type: '冒充客服引流',
        suspicious_points: ['要求安装陌生客服应用办理业务'],
        summary: '对方以取消服务为由引导安装陌生应用，存在远程控制或信息窃取风险。',
      }),
    }),
  })
  assert.equal(result.risk.level, 'high')
  assert.equal(result.risk.score, 76)
  assert.equal(result.fraud_type, '冒充客服引流')
  assert.match(result.report, /远程控制或信息窃取风险/)
})

test('RAG and web failures degrade to a rule-grounded report', async () => {
  const result = await runAssessFraudRisk({
    text: '请点击链接填写资料',
  }, {}, {
    ...baseDeps,
    getReadiness: async () => { throw new Error('RAG offline') },
    webSearch: async () => { throw new Error('web offline') },
    callLLM: null,
  })
  assert.equal(result.ok, true)
  assert.match(result.rag.status_label, /RAG 不可用/)
  assert.match(result.report, /研判依据/)
})

test('loss state normalization distinguishes unknown, none, and confirmed', () => {
  assert.equal(normalizeLossStatus('', '还没有转账'), 'none')
  assert.equal(normalizeLossStatus('', '已经转账 100 元'), 'confirmed')
  assert.equal(normalizeLossStatus('', '只是想确认一下'), 'unknown')
})
