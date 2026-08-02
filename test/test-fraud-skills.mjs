// test/test-fraud-skills.mjs
//
// 单元测试：验证 Feature #2/#3/#4 的5个工具输入输出正确
// 运行方式: node test/test-fraud-skills.mjs

import { execGetDailyTip } from '../src/capabilities/tools/daily-tip.js'
import { execReportFraud, execSearchLaw, execCheckQrcode, execVerifyIdentity } from '../src/capabilities/tools/fraud-toolkit.js'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

function parseResult(result) {
  try {
    return JSON.parse(result)
  } catch {
    return null
  }
}

console.log('\n========================================')
console.log('  小盾反诈 Skill 工具单元测试')
console.log('========================================\n')

// ─── 1. get_daily_tip ───────────────────────────────────────────────────────

console.log('【测试1】get_daily_tip — 每日反诈提醒\n')

{
  const result = execGetDailyTip({})
  const data = parseResult(result)
  assert(data !== null, '返回有效 JSON')
  assert(data.ok === true, 'ok=true')
  assert(data.tip && data.tip.title, 'tip.title 存在')
  assert(data.tip && data.tip.content, 'tip.content 存在')
  assert(data.tip && data.tip.actionable_advice, 'tip.actionable_advice 存在')
  assert(data.source_type === 'seed' || data.source_type === 'user' || data.source_type === 'fraud_intel', `source_type="${data.source_type}"`)
  assert(data.date && data.date.length === 10, `date="${data.date}" 格式正确`)
  assert(data.total_seed_tips === 30, `内置30条种子tips (actual: ${data.total_seed_tips})`)
}

console.log('\n  --- 确定性测试：同一天返回同一条tip ---')
{
  const r1 = parseResult(execGetDailyTip({ date: '2026-08-02' }))
  const r2 = parseResult(execGetDailyTip({ date: '2026-08-02' }))
  assert(r1.tip.title === r2.tip.title, '同一天返回同一条tip')
}

console.log('\n  --- 按类型筛选 ---')
{
  const result = execGetDailyTip({ category: 'drill' })
  const data = parseResult(result)
  assert(data.tip && data.tip.category === 'drill', `category="drill" 筛选正确 (actual: ${data.tip?.category})`)
}

console.log('\n  --- 不同日期返回不同tip ---')
{
  const r1 = parseResult(execGetDailyTip({ date: '2026-01-01' }))
  const r2 = parseResult(execGetDailyTip({ date: '2026-06-15' }))
  // 不一定不同（hash可能碰撞），但大概率不同
  console.log(`    Jan 1: ${r1.tip.title}`)
  console.log(`    Jun 15: ${r2.tip.title}`)
}

// ─── 2. report_fraud ────────────────────────────────────────────────────────

console.log('\n【测试2】report_fraud — 一键举报指引\n')

{
  const result = execReportFraud({ fraud_type: 'brushing', description: '我被刷单骗了5000块' })
  const data = parseResult(result)
  assert(data !== null, '返回有效 JSON')
  assert(data.ok === true, 'ok=true')
  assert(data.channels && data.channels.length >= 4, `举报渠道>=4个 (actual: ${data.channels?.length})`)
  assert(data.channels.some(c => c.number === '96110'), '包含96110反诈专线')
  assert(data.channels.some(c => c.number === '110'), '包含110报警电话')
  assert(data.steps && data.steps.length >= 5, `举报步骤>=5步 (actual: ${data.steps?.length})`)
  assert(data.evidence_tips && data.evidence_tips.length >= 5, `证据保全建议>=5条 (actual: ${data.evidence_tips?.length})`)
  assert(data.hotline === '96110', 'hotline=96110')
  assert(data.fraud_type_name === '刷单返利', `fraud_type_name正确 (actual: ${data.fraud_type_name})`)
}

console.log('\n  --- 默认类型 ---')
{
  const result = execReportFraud({})
  const data = parseResult(result)
  assert(data.fraud_type === 'general', '默认 fraud_type=general')
  assert(data.channels.length >= 4, '默认也有完整渠道列表')
}

// ─── 3. search_law ──────────────────────────────────────────────────────────

console.log('\n【测试3】search_law — 法规检索\n')

{
  const result = execSearchLaw({ query: '诈骗 量刑', limit: 5 })
  const data = parseResult(result)
  assert(data !== null, '返回有效 JSON')
  assert(data.ok === true, 'ok=true')
  assert(data.count > 0, `有匹配结果 (count: ${data.count})`)
  assert(data.results && data.results.length > 0, 'results数组非空')
  assert(data.results[0].title, '第一条有title')
  assert(data.results[0].article, '第一条有article')
  assert(data.results[0].content, '第一条有content')
  assert(data.total_laws >= 10, `内置法规>=10条 (actual: ${data.total_laws})`)
}

console.log('\n  --- 搜索"反诈法" ---')
{
  const result = execSearchLaw({ query: '反诈法' })
  const data = parseResult(result)
  assert(data.count > 0, '搜索"反诈法"有结果')
  const hasAntiFraudLaw = data.results.some(r => r.title.includes('反电信网络诈骗法'))
  assert(hasAntiFraudLaw, '结果包含反电信网络诈骗法')
}

console.log('\n  --- 搜索"个人信息" ---')
{
  const result = execSearchLaw({ query: '个人信息' })
  const data = parseResult(result)
  assert(data.count > 0, '搜索"个人信息"有结果')
}

console.log('\n  --- 空查询 ---')
{
  const result = execSearchLaw({ query: '' })
  const data = parseResult(result)
  assert(data.ok === false, '空查询返回错误')
  assert(data.error, '有错误信息')
}

// ─── 4. check_qrcode ────────────────────────────────────────────────────────

console.log('\n【测试4】check_qrcode — 二维码内容分析\n')

{
  const result = execCheckQrcode({ content: 'http://fake-bank-update.xyz/login?account=verify' })
  const data = parseResult(result)
  assert(data !== null, '返回有效 JSON')
  assert(data.ok === true, 'ok=true')
  assert(data.content_type === 'url', 'content_type=url')
  assert(data.domain, `domain存在 (actual: ${data.domain})`)
  assert(data.is_url === true, 'is_url=true')
  assert(data.risk_indicators && data.risk_indicators.length > 0, `有风险指标 (count: ${data.risk_indicators?.length})`)
  assert(data.safety_score < 60, `安全分较低 (actual: ${data.safety_score})`)
  assert(data.is_phishing === true, 'is_phishing=true (高风险)')
}

console.log('\n  --- 安全URL ---')
{
  const result = execCheckQrcode({ content: 'https://www.taobao.com/item/123456' })
  const data = parseResult(result)
  assert(data.safety_score >= 70, `安全分较高 (actual: ${data.safety_score})`)
  assert(data.is_phishing === false, 'is_phishing=false')
}

console.log('\n  --- 支付内容 ---')
{
  const result = execCheckQrcode({ content: '收款方：张三，金额：500元' })
  const data = parseResult(result)
  assert(data.content_type === 'payment', 'content_type=payment')
  assert(data.safety_score < 80, '支付内容安全分降低')
}

console.log('\n  --- IP地址URL ---')
{
  const result = execCheckQrcode({ content: 'http://192.168.1.1:8080/verify' })
  const data = parseResult(result)
  assert(data.risk_indicators.some(i => i.type === 'ip_address'), '检测到IP地址风险')
  assert(data.risk_indicators.some(i => i.type === 'unusual_port'), '检测到非标准端口')
}

// ─── 5. verify_identity ─────────────────────────────────────────────────────

console.log('\n【测试5】verify_identity — 综合身份核实\n')

{
  const text = '我是公安局的，你涉嫌洗钱案件，需要你把资金转入安全账户进行清查，验证码发给我'
  const result = execVerifyIdentity({ text, phone: '13800138000', url: 'http://safe-account.xyz/verify' })
  const data = parseResult(result)
  assert(data !== null, '返回有效 JSON')
  assert(data.ok === true, 'ok=true')
  assert(data.risk_level, `risk_level存在 (actual: ${data.risk_level})`)
  assert(data.risk_score >= 0 && data.risk_score <= 100, `risk_score在0-100 (actual: ${data.risk_score})`)
  assert(data.findings && data.findings.length >= 1, `findings>=1 (actual: ${data.findings?.length})`)
  
  const ruleEngineFinding = data.findings.find(f => f.source === 'rule_engine')
  assert(ruleEngineFinding, '包含规则引擎分析结果')
  assert(ruleEngineFinding.matched === true, '规则引擎命中诈骗话术')
  
  const urlFinding = data.findings.find(f => f.source === 'url_analysis')
  assert(urlFinding, '包含URL分析结果')
  
  const phoneFinding = data.findings.find(f => f.source === 'phone_analysis')
  assert(phoneFinding, '包含电话号码分析结果')
  
  assert(data.risk_level === 'critical' || data.risk_level === 'high', `综合风险等级为critical或high (actual: ${data.risk_level})`)
  assert(data.hotline === '96110', 'hotline=96110')
}

console.log('\n  --- 安全内容 ---')
{
  const result = execVerifyIdentity({ text: '你好，我是淘宝卖家，您购买的鞋子已经发货了' })
  const data = parseResult(result)
  assert(data.risk_level === 'low' || data.risk_level === 'medium', `正常文本风险较低 (actual: ${data.risk_level})`)
}

console.log('\n  --- 仅URL ---')
{
  const result = execVerifyIdentity({ url: 'https://www.jd.com' })
  const data = parseResult(result)
  assert(data.findings.some(f => f.source === 'url_analysis'), '仅URL也有URL分析结果')
}

// ─── 汇总 ───────────────────────────────────────────────────────────────────

console.log('\n========================================')
console.log(`  测试结果: ${passed} 通过, ${failed} 失败`)
console.log('========================================\n')

if (failed > 0) {
  console.error('❌ 有测试失败！')
  process.exit(1)
} else {
  console.log('✅ 全部测试通过！')
  process.exit(0)
}
