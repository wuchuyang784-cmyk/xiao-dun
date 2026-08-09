import crypto from 'node:crypto'

import { emitEvent } from '../../events.js'
import { insertAnalysisRecord } from '../../db/repositories/analysis-records.js'
import { searchRiskTexts, getRagReadiness } from '../../services/rag-client.js'
import { execFraudRuleScreen } from './fraud-rule.js'
import { execCheckLink } from './check-link.js'
import { execAnalyzeFraudImage } from './fraud-image.js'
import { execWebSearch } from './web.js'

const URL_RE = /https?:\/\/[^\s"'<>]+|www\.[^\s"'<>]+|(?<![@\w-])(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s"'<>]*)?/gi
const IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/gi
const MAX_TEXT_LENGTH = 8_000
const MAX_LINKS = 5
const MAX_CASES = 5
const MAX_WECHAT_LENGTH = 1_800
const MAX_CASE_REPORT_SOURCE_LENGTH = 360

const AUTHORITY_HOST_RE = /(?:^|\.)gov\.cn$|(?:^|\.)police\.cn$|(?:^|\.)csrc\.gov\.cn$|(?:^|\.)pbc\.gov\.cn$|(?:^|\.)court\.gov\.cn$|(?:^|\.)npa\.gov\.cn$|(?:^|\.)chinacourt\.org$|(?:^|\.)12321\.cn$/i

function parseJson(value) {
  try {
    return JSON.parse(String(value || ''))
  } catch {
    return null
  }
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value)
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.round(n)))
}

function levelFromScore(score, lossStatus = 'unknown') {
  const n = clamp(score)
  if (lossStatus === 'confirmed' && n >= 70) return 'critical'
  if (n >= 70) return 'high'
  if (n >= 50) return 'medium'
  return 'low'
}

function levelLabel(level) {
  return ({ low: '低风险', medium: '中风险', high: '高风险', critical: '紧急高风险' })[level] || '待确认'
}

function normalizeLossStatus(value, text = '') {
  const raw = String(value || '').trim().toLowerCase()
  if (['none', 'no', 'false', '0', '无', '没有', '未转账', '未损失', '没有损失'].some(v => raw === v || raw.includes(v))) {
    return 'none'
  }
  if (['confirmed', 'yes', 'true', '1', '有', '已转账', '已付款', '已损失', '被骗', '损失'].some(v => raw === v || raw.includes(v))) {
    return 'confirmed'
  }
  const source = String(text || '')
  if (/(已转账|已经转账|已付款|已经付款|已打款|已经打款|被骗了|造成损失|损失了|钱被骗)/i.test(source)) return 'confirmed'
  if (/(没有转账|未转账|没有付款|未付款|没有损失|未造成损失|还没转账)/i.test(source)) return 'none'
  return 'unknown'
}

function removeRiskCommand(text = '') {
  return String(text || '')
    .replace(/^\/(?:risk_assess|风险研判|诈骗研判)\b/iu, '')
    .trim()
}

function extractUrls(text = '') {
  return [...new Set((String(text || '').match(URL_RE) || [])
    .map(url => url.replace(/[，。！？；、）】\]}>,.]+$/g, '').trim())
    .filter(Boolean))]
    .slice(0, MAX_LINKS)
}

function extractImageRefs(text = '') {
  const refs = []
  let match
  while ((match = IMAGE_RE.exec(String(text || ''))) !== null) {
    if (match[1]) refs.push(match[1].trim())
  }
  return refs
}

function normalizeAttachments(args = {}, context = {}) {
  const values = [
    ...(Array.isArray(args.attachments) ? args.attachments : []),
    ...(Array.isArray(context.attachments) ? context.attachments : []),
  ]
  const seen = new Set()
  return values.filter(item => {
    if (!item || typeof item !== 'object') return false
    const key = String(item.path || item.url || item.data_url || item.dataUrl || item.markdown || '')
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)
}

function attachmentRef(item) {
  return String(
    item?.path
    || item?.image_path
    || item?.imagePath
    || item?.url
    || item?.data_url
    || item?.dataUrl
    || '',
  ).trim()
}

function normalizeText(args = {}, context = {}) {
  const explicit = args.text || args.content || args.message || args.analysis_text
  const fallback = context.currentUserMessage || ''
  const raw = removeRiskCommand(explicit || fallback)
  const withoutImages = raw
    .replace(IMAGE_RE, '')
    .replace(/\[微信(?:图片|文件)[^\]]*]\([^)]*\)/gi, '')
    .replace(/\s{3,}/g, '\n\n')
    .trim()
  return withoutImages.slice(0, MAX_TEXT_LENGTH)
}

function normalizeRuleEvidence(rule = {}) {
  return (Array.isArray(rule.hits) ? rule.hits : []).map(hit => ({
    id: hit.id || '',
    type: hit.type || '未知风险类型',
    risk: hit.risk || 'unknown',
    score: clamp(hit.score),
    matched_keywords: Array.isArray(hit.matchedKeywords) ? hit.matchedKeywords.slice(0, 8) : [],
    signals: Array.isArray(hit.signals) ? hit.signals.slice(0, 8) : [],
    playbook: Array.isArray(hit.playbook) ? hit.playbook.slice(0, 6) : [],
    advice: Array.isArray(hit.advice) ? hit.advice.slice(0, 6) : [],
  }))
}

function supplementalRuleScreen(text = '') {
  const value = String(text || '')
  const hits = []
  const add = (id, type, score, keywords, signals) => hits.push({
    id,
    type,
    risk: 'high',
    score,
    matchedKeywords: keywords,
    signals,
    playbook: [],
    advice: [],
  })
  if (/(客服|退款|理赔|订单异常)/.test(value) && /(验证码|银行卡|转账|链接|二维码|屏幕共享)/.test(value)) {
    add('supplement_refund', '冒充客服退款', 82, ['客服/退款', '验证码/转账'], ['以退款或订单异常为由索要敏感信息'])
  }
  if (/(公安|检察院|法院|安全账户|洗钱|通缉)/.test(value) && /(转账|验证码|屏幕共享|保密|冻结)/.test(value)) {
    add('supplement_authority', '冒充公检法', 95, ['公检法/安全账户', '转账/验证码'], ['以涉案或账户冻结施压并要求资金操作'])
  }
  if (
    /(公安|警察|警官|检察院|法院|公检法)/.test(value)
    && /(账户|账号|资金|涉案|流水|异常|冻结)/.test(value)
    && /(密码|银行卡密码|账户密码|网银密码|验证码|提供.*(?:密码|银行卡)|转账|安全账户|屏幕共享)/.test(value)
  ) {
    add(
      'supplement_authority_credentials',
      '冒充公检法索要账户密码',
      98,
      ['公安/公检法', '账户异常/涉案', '银行卡或账户密码'],
      ['公检法机关不会通过电话索要银行卡、网银或账户密码'],
    )
  }
  if (/(低息|无抵押|解冻费|保证金|手续费|刷流水)/.test(value) && /(贷款|放款|银行卡|转账|缴费)/.test(value)) {
    add('supplement_loan', '虚假贷款或解冻诈骗', 84, ['贷款/解冻费', '先缴费'], ['放款前要求手续费、保证金或刷流水'])
  }
  if (/(领导|老板|同事|新号)/.test(value) && /(转账|代付|借钱|急用钱)/.test(value)) {
    add('supplement_impersonation', '冒充熟人或领导', 80, ['熟人身份', '紧急转账'], ['绕过原有联系方式催促付款'])
  }
  if (
    /(充值券|话费券|充值优惠|低价充值|话费充值|充值返利|一分钱|9\.9元|9元9)/i.test(value)
    && /(点击|领取|充值|链接|https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,63})/i.test(value)
  ) {
    add(
      'supplement_recharge_coupon',
      '虚假充值优惠/钓鱼链接',
      86,
      ['低价充值/话费券', '点击或领取', '外部链接'],
      ['以异常低价充值或优惠券诱导点击，可能进入钓鱼页面或订阅扣费页面'],
    )
  }
  const insuranceService = /(保险(?:服务|保障|保单)?|保费|保单|保险公司)/.test(value)
  const recurringCharge = /(自动(?:续费|扣费)|每(?:个)?月.{0,8}(?:扣费|收费)|到期.{0,12}(?:扣费|续费)|不取消.{0,16}(?:扣费|收费)|续保)/.test(value)
  const cancellationPressure = /(取消(?:保险|服务|保单|续费)?|退订|关闭(?:服务|续费)?|解约)/.test(value)
  const directedOperation = /(按照?.{0,8}(?:所说|指导|要求).{0,8}(?:操作|办理)|跟着?.{0,8}(?:操作|办理)|下载.{0,12}App|屏幕共享|远程协助|添加.{0,8}(?:客服|微信))/.test(value)
  const suspiciousCaller = /(00开头|陌生(?:来电|电话)|境外(?:来电|电话)|国际(?:来电|电话))/.test(value)
  if (insuranceService && recurringCharge && cancellationPressure && directedOperation) {
    add(
      'supplement_insurance_cancellation',
      '冒充保险客服取消续费诈骗',
      suspiciousCaller ? 92 : 84,
      ['保险到期/续费', '自动扣费施压', '取消需按对方步骤操作'],
      [
        '以保险到期或自动扣费制造损失焦虑，诱导脱离官方渠道办理取消',
        suspiciousCaller
          ? '来电号码异常或为陌生号码，且要求按对方指引操作'
          : '正规保险取消或退订应通过保单官方渠道核实，不应听从陌生来电操作',
      ],
    )
  }
  return { score: hits.reduce((max, hit) => Math.max(max, hit.score), 0), hits }
}

function normalizeCases(items = [], source = 'rag') {
  if (!Array.isArray(items)) return []
  return items.slice(0, MAX_CASES).map((item, index) => ({
    rank: index + 1,
    source,
    title: String(item.title || item.risk_text_title || item.text || item.snippet || '相似反诈案例').slice(0, 90),
    category: String(item.category || item.category_name || item.risk_category_name || item.risk_category_code || '').slice(0, 40),
    similarity: typeof item.similarity === 'number'
      ? item.similarity
      : typeof item.score === 'number'
        ? item.score
        : null,
    url: String(item.url || item.link || '').trim(),
    snippet: String(item.snippet || item.text || item.normalized_text || item.content || '').replace(/\s+/g, ' ').slice(0, 180),
  }))
}

function officialWebCases(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : []
  return results.filter(item => {
    try {
      return AUTHORITY_HOST_RE.test(new URL(item.url).hostname)
    } catch {
      return false
    }
  }).slice(0, MAX_CASES)
}

function collectSuspiciousPoints(ruleHits, linkChecks, image = null) {
  const points = []
  for (const hit of ruleHits) {
    if (hit.type) points.push(`${hit.type}${hit.matched_keywords.length ? `：命中“${hit.matched_keywords.slice(0, 4).join('、')}”` : ''}`)
    for (const signal of hit.signals.slice(0, 2)) points.push(signal)
  }
  for (const link of linkChecks) {
    for (const finding of (link.findings || link.indicators || []).slice(0, 3)) {
      points.push(String(finding.message || finding.detail || finding.type || '链接存在异常特征'))
    }
    if (link.ok === false) points.push(`链接检测失败：${link.message || link.error || '无法完成检测'}`)
  }
  for (const uncertainty of image?.uncertainties || []) points.push(`图片识别不确定：${uncertainty}`)
  if (image?.imageType === 'qr_code' && !(image.entities?.qr_codes || []).length) {
    points.push('发现二维码图像，但未能提取二维码内容，不能据此判断安全')
  }
  return [...new Set(points.filter(Boolean))].slice(0, 8)
}

function buildActions(level, lossStatus) {
  const immediate = [
    '先暂停点击链接、扫码、下载 App 或继续聊天操作',
    '不要提供验证码、密码、身份证号或屏幕共享',
  ]
  const prevention = [
    '只通过官方 App、官网或已知客服电话核实',
    '保留原始聊天、图片、链接、号码和转账凭证',
  ]
  if (lossStatus === 'confirmed') {
    immediate.unshift('立即停止操作，不要再向对方转账或缴费')
    immediate.push('马上联系银行申请止付、冻结或撤回，并拨打 96110；金额较大或正在被控制时拨打 110')
    prevention.push('后续不再相信“交保证金、解冻费、追回费”等二次收费')
  } else if (lossStatus === 'none') {
    immediate.push('目前未说明有实际损失，保持警惕并删除或拉黑可疑联系人')
  } else {
    immediate.push('如已转账或付款，请立即补充说明，处置时效很重要')
  }
  if (level === 'low') immediate[0] = '暂未发现明确诈骗特征，但不要直接点击陌生链接或扫码'
  return { immediate: [...new Set(immediate)].slice(0, 5), prevention: [...new Set(prevention)].slice(0, 4) }
}

function uniqueText(values = [], limit = 5) {
  return [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))].slice(0, limit)
}

function extractPhoneNumbers(text = '') {
  return uniqueText(String(text || '').match(/(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g) || [])
}

function extractBankAccounts(text = '') {
  return uniqueText(String(text || '').match(/(?<!\d)\d(?:[\s-]?\d){14,18}(?!\d)/g) || [])
    .map(value => value.replace(/[\s-]/g, ''))
}

function extractAmounts(text = '') {
  const amounts = []
  const matcher = /(?:人民币|RMB|¥|￥)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,2})?)\s*(万元|万|元)/gi
  let match
  while ((match = matcher.exec(String(text || ''))) !== null) {
    amounts.push(`${match[1]}${match[2]}`)
  }
  return uniqueText(amounts, 3)
}

function extractPaymentChannels(text = '') {
  const source = String(text || '')
  return uniqueText([
    /微信支付|微信转账/.test(source) ? '微信支付' : '',
    /支付宝/.test(source) ? '支付宝' : '',
    /银行卡|银行转账|网银|手机银行/.test(source) ? '银行卡/银行转账' : '',
    /数字钱包|虚拟币|USDT/.test(source) ? '数字钱包/虚拟币' : '',
  ], 3)
}

function formatReportSourceChannel(channel = '') {
  const value = String(channel || '').trim()
  if (!value) return '待补充'
  if (/^(?:API|TUI)$/i.test(value)) return '网页端'
  if (/^WECHAT/i.test(value)) return '微信'
  return value
}

function buildCaseReportTemplate(data, { sourceText = '', attachments = [], channel = '' } = {}) {
  const facts = String(sourceText || '').replace(/\s+/g, ' ').trim()
  const links = uniqueText(data.links?.detected || [])
  const phones = extractPhoneNumbers(facts)
  const accounts = extractBankAccounts(facts)
  const confirmedLoss = data.loss_status === 'confirmed'
  const amounts = confirmedLoss ? extractAmounts(facts) : []
  const paymentChannels = extractPaymentChannels(facts)
  const attachmentCount = Array.isArray(attachments) ? attachments.length : 0
  const sourceChannel = formatReportSourceChannel(channel)
  const templateTitle = confirmedLoss
    ? '【疑似电信网络诈骗案件情况说明（草稿）】'
    : '【高风险诈骗线索 / 报案材料草稿】'
  const lossStatement = confirmedLoss ? '是' : '尚未确认（如已转账或扣费请补充）'
  const missing = [
    '报案人姓名和联系方式',
    '准确发生时间、转账时间和地点',
    accounts.length ? '' : '收款账户、开户行或收款二维码',
    amounts.length ? '' : '实际损失金额和支付流水号',
    phones.length ? '' : '对方完整电话号码、账号或昵称',
    links.length ? '' : '对方提供的链接或二维码内容',
    '已联系银行、平台、96110、110 的时间和结果',
  ].filter(Boolean)

  const evidence = [
    '原始聊天记录和截图',
    attachmentCount ? `已提交的图片/附件（${attachmentCount} 项）` : '',
    links.length ? '涉诈链接或二维码截图' : '',
    amounts.length || paymentChannels.length ? '转账凭证、订单号和交易流水' : '',
    '与银行、平台、96110、110 的沟通记录',
  ].filter(Boolean)

  const lines = [
    templateTitle,
    confirmedLoss
      ? '提示：仅根据已知事实整理，请核对、补充后再用于报案。'
      : '提示：风险较高，建议先保存证据；如需报案或咨询警方，可补全以下材料。',
    '',
    '一、基本案情',
    '- 报案人：［待补充］',
    '- 联系方式：［待补充］',
    '- 发生地点：［待补充］',
    '- 发现时间：［待补充］',
    `- 初步诈骗类型：${data.fraud_type || '待核实'}`,
    `- 是否确认损失：${lossStatement}`,
    '',
    '二、诈骗经过',
    '- ［待补充准确时间］：通过' + sourceChannel + '收到或发现可疑信息。',
    `- 对方以“${data.fraud_type || '待核实'}”相关话术诱导操作。`,
    facts ? `- 用户提供的原始内容摘要：${facts.slice(0, MAX_CASE_REPORT_SOURCE_LENGTH)}` : '- 用户提供的原始内容摘要：［待补充］',
    '',
    '三、对方及涉案信息',
    `- 对方自称身份：${data.fraud_type || '待核实'}`,
    `- 电话号码：${phones.length ? phones.join('；') : '［待补充］'}`,
    `- 收款账户/银行卡：${accounts.length ? accounts.join('；') : '［待补充］'}`,
    `- 链接或二维码内容：${links.length ? links.join('；') : '［待补充］'}`,
    '- 平台/App/账号昵称：［待补充］',
    '',
    '四、涉案金额与支付渠道',
    `- 实际损失金额：${amounts.length ? `人民币${amounts.join('；')}` : confirmedLoss ? '［待补充］' : '尚未确认（如有请补充）'}`,
    `- 支付渠道：${paymentChannels.length ? paymentChannels.join('；') : '［待补充］'}`,
    '- 支付/转账时间：［待补充］',
    '- 交易流水号/订单号：［待补充］',
    '',
    '五、证据清单',
    ...evidence.map((item, index) => `${index + 1}. ${item}`),
    '',
    '六、已采取措施',
    '- 已联系银行止付/冻结：［待补充］',
    '- 已联系平台申诉：［待补充］',
    '- 已拨打 96110 / 110：［待补充］',
    '- 已修改密码、解绑银行卡或关闭权限：［待补充］',
    '',
    '七、待补充信息',
    ...missing.map((item, index) => `${index + 1}. ${item}`),
  ]

  const wechatLines = [
    confirmedLoss ? '【报案材料草稿】' : '【高风险报案材料草稿】',
    confirmedLoss ? '仅含已知事实，请核对后补充。' : '风险较高，先保存证据；如需报案请补全。',
    '────',
    `1. 类型：${data.fraud_type || '待核实'}`,
    `2. 原始内容：${facts ? facts.slice(0, 180) : '待补充'}`,
    `3. 电话：${phones.join('；') || '待补充'}`,
    `4. 账户：${accounts.join('；') || '待补充'}`,
    `5. 链接：${links.join('；') || '待补充'}`,
    `6. 金额：${amounts.length ? `人民币${amounts.join('；')}` : confirmedLoss ? '待补充' : '尚未确认'}`,
    `7. 支付渠道：${paymentChannels.join('；') || '待补充'}`,
    '────',
    '需补充：准确时间、收款账户、流水号、银行止付和报警处理结果。',
  ]

  return {
    generated: true,
    text: lines.join('\n'),
    wechat_text: trimWechat(wechatLines.join('\n')),
    missing_fields: missing,
    extracted: { phones, accounts, amounts, payment_channels: paymentChannels, links },
  }
}

function buildConciseReport(data) {
  const lines = []
  if (data.loss_status === 'confirmed') lines.push('【紧急提醒】立即停止操作，不要再转账；马上联系银行止付，并拨打 96110 或 110。', '')
  lines.push(`【诈骗风险研判】${levelLabel(data.risk.level)}｜${data.risk.score}/100`)
  lines.push(`诈骗类型：${data.fraud_type}`)
  lines.push(`损失状态：${data.loss_status === 'confirmed' ? '已确认有实际损失' : data.loss_status === 'none' ? '暂未造成实际损失' : '尚未确认'}`)
  lines.push(`研判结论：${data.assessment_summary || data.llm_summary || '请结合以下可疑点谨慎处理。'}`)
  lines.push('', '可疑点：')
  if (data.suspicious_points.length) data.suspicious_points.slice(0, 3).forEach((item, index) => lines.push(`${index + 1}. ${item}`))
  else lines.push('1. 暂未命中明确规则；这不等于信息安全。')
  lines.push('', `研判依据：规则${data.evidence.rules.length ? `命中 ${data.evidence.rules.length} 项` : '未命中'}；链接${data.links.checked.length ? `已检测 ${data.links.checked.length} 条` : '未提供'}。`)
  if (data.similar_cases.length) lines.push(`参考案例：${data.similar_cases[0].title}`)
  lines.push('', '立即处置：')
  data.immediate_actions.slice(0, 3).forEach(item => lines.push(`- ${item}`))
  lines.push('', '防范：')
  data.prevention_actions.slice(0, 2).forEach(item => lines.push(`- ${item}`))
  if (data.case_report?.text) lines.push('', data.case_report.text)
  if (data.loss_status === 'unknown') lines.push('', '请只补充一句：是否已经转账或造成实际损失？')
  return lines.join('\n')
}

function buildWechatReport(data) {
  const lines = []
  if (data.loss_status === 'confirmed') {
    lines.push('【紧急提醒】立即停止操作，不要再转账；联系银行止付，拨打96110或110。', '────')
  }
  lines.push('【小盾·诈骗风险研判】')
  lines.push(`结论：${levelLabel(data.risk.level)}（${data.risk.score}/100）`)
  lines.push(`类型：${data.fraud_type}`)
  lines.push(`损失：${data.loss_status === 'confirmed' ? '已确认' : data.loss_status === 'none' ? '暂未发生' : '未确认'}`)
  lines.push('────', '可疑点：')
  if (data.suspicious_points.length) data.suspicious_points.slice(0, 5).forEach((item, index) => lines.push(`${index + 1}. ${item}`))
  else lines.push('1. 暂未命中明确规则，不代表安全。')
  lines.push(`案例：${data.similar_cases[0]?.title || '暂无可用相似案例'}`)
  lines.push(`RAG：${data.rag.status_label}`)
  lines.push('────', '立即处理：')
  data.immediate_actions.slice(0, 4).forEach(item => lines.push(`- ${item}`))
  if (data.loss_status !== 'confirmed') {
    lines.push('后续防范：')
    data.prevention_actions.slice(0, 3).forEach(item => lines.push(`- ${item}`))
  }
  if (data.case_report?.wechat_text) lines.push('', data.case_report.wechat_text)
  if (data.loss_status === 'unknown') lines.push('请回复：是否已转账或造成实际损失？')
  return trimWechat(lines.join('\n'))
}

function trimWechat(text) {
  const value = String(text || '')
  if (value.length <= MAX_WECHAT_LENGTH) return value
  return `${value.slice(0, MAX_WECHAT_LENGTH - 18).trim()}\n…内容已精简，请在网页端查看完整报告`
}

function parseLlmObject(value) {
  const text = String(value || '').trim()
  if (!text) return null
  const direct = parseJson(text)
  if (direct && typeof direct === 'object') return direct
  const unfenced = text.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()
  const embedded = unfenced.match(/\{[\s\S]*\}/)
  return embedded ? parseJson(embedded[0]) : null
}

function normalizeLlmTriage(value) {
  const payload = parseLlmObject(value)
  if (!payload || typeof payload !== 'object') return null
  const score = Number(payload.risk_score ?? payload.score)
  if (!Number.isFinite(score)) return null
  const suspiciousPoints = Array.isArray(payload.suspicious_points)
    ? payload.suspicious_points.map(item => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : []
  return {
    score: clamp(score),
    fraud_type: String(payload.fraud_type || payload.type || '').trim().slice(0, 60),
    suspicious_points: suspiciousPoints,
    summary: String(payload.summary || payload.reason || '').replace(/\s+/g, ' ').trim().slice(0, 120),
  }
}

async function runLlmTriage({ text, ruleHits, linkChecks, lossStatus }, callLLM) {
  if (typeof callLLM !== 'function' || !text) return null
  try {
    const result = await callLLM({
      systemPrompt: [
        '你是小盾反诈研判复核器。根据用户原文和已给出的证据判断风险。',
        '陌生来电、自动扣费/续费施压、要求按对方步骤操作、索要敏感信息、引流下载或转账均是重要风险信号。',
        '只能输出一个 JSON 对象，不调用工具，不输出 send_message。',
        '字段：risk_score(0-100)、fraud_type、suspicious_points(最多4条)、summary(不超过60字)。',
      ].join(''),
      message: JSON.stringify({
        suspicious_text: String(text).slice(0, 1800),
        rule_hits: ruleHits.map(hit => ({ type: hit.type, signals: hit.signals, score: hit.score })).slice(0, 5),
        checked_links: linkChecks.map(item => ({ url: item.url, risk_score: item.risk_score ?? item.risk?.score ?? null })).slice(0, 3),
        loss_status: lossStatus,
      }),
      tools: [],
      temperature: 0,
      maxTokens: 220,
      thinking: false,
      mustReply: true,
    })
    return normalizeLlmTriage(result?.content)
  } catch {
    return null
  }
}

function buildAssessmentSummary(data) {
  if (data.llm_summary) return data.llm_summary
  const point = data.suspicious_points[0] || ''
  if (data.risk.level === 'low') return '暂未发现足以确认诈骗的证据，但仍不要按陌生人指引进行资金或账户操作。'
  const detail = point.startsWith(data.fraud_type)
    ? point.slice(data.fraud_type.length).replace(/^[:：\s]+/, '')
    : point
  return `${data.fraud_type}${detail ? `：${detail}` : '，存在明显社会工程诱导特征。'}`
}

async function runLlmSummary(data, callLLM) {
  if (typeof callLLM !== 'function') return ''
  try {
    const result = await callLLM({
      systemPrompt: '你是小盾反诈研判助手。只根据给定工具证据，用不超过80字中文压缩综合判断。不要新增事实，不要弱化高风险，不要输出Markdown表格。',
      message: JSON.stringify({
        score: data.risk.score,
        level: data.risk.level,
        type: data.fraud_type,
        suspicious_points: data.suspicious_points,
        loss_status: data.loss_status,
        rag: data.rag.status_label,
      }),
      tools: [],
      temperature: 0.1,
      maxTokens: 180,
      thinking: false,
      mustReply: true,
    })
    return normalizeLlmSummary(result?.content)
  } catch {
    return ''
  }
}

function normalizeLlmSummary(value) {
  let text = String(value || '').trim()
  if (!text) return ''
  const payload = parseJson(text)
  if (payload && typeof payload === 'object') {
    text = String(payload.content || payload.text || payload.reply || payload.response || '').trim()
  }
  text = text.replace(/^综合判断[：:]\s*/, '').replace(/\s+/g, ' ').trim()
  // A provider can return a JavaScript-like tool call instead of a reply.
  // Keep the deterministic evidence report rather than showing that payload.
  if (/\b(?:send_message|assess_fraud_risk)\s*\(/i.test(text)) return ''
  if (!text || /^(?:send_message|assess_fraud_risk)$/i.test(text)) return ''
  return text.slice(0, 160)
}

function saveRecord(data, inputText, durationMs) {
  const recordId = `fraud-risk-${crypto.randomUUID()}`
  try {
    insertAnalysisRecord({
      recordId,
      inputSummary: (inputText || data.fraud_type || '诈骗风险研判').slice(0, 240),
      inputHash: crypto.createHash('sha256').update(inputText || '').digest('hex'),
      fraudType: data.fraud_type,
      riskLevel: data.risk.level,
      rulesHit: data.evidence.rules,
      modelUsed: data.llm_summary ? 'rule + link + rag/web + llm' : 'rule + link + rag/web',
      latencyMs: durationMs,
      source: 'assess_fraud_risk',
    }, { ignoreConflict: true })
  } catch {
    // Local audit persistence must not make the assessment unavailable.
  }
  return recordId
}

export async function runAssessFraudRisk(args = {}, context = {}, deps = {}) {
  const startedAt = Date.now()
  const attachments = normalizeAttachments(args, context)
  const inputText = normalizeText(args, context)
  const attachmentRefs = attachments.map(attachmentRef).filter(Boolean)
  const imageRefs = [...extractImageRefs(context.currentUserMessage || ''), ...attachmentRefs]
  const imageRef = String(args.image_path || args.imagePath || args.image_url || args.imageUrl || imageRefs[0] || '').trim()
  const lossStatus = normalizeLossStatus(args.loss_status || args.lossStatus, `${inputText}\n${context.currentUserMessage || ''}`)
  const queryText = inputText || String(args.query_text || args.queryText || '').trim()

  if (!queryText && !imageRef) {
    return {
      ok: false,
      tool: 'assess_fraud_risk',
      error: 'empty_input',
      message: '请提供聊天文字或截图后再进行诈骗风险研判。',
    }
  }

  let rule = { score: 0, level: '', hits: [], summary: '' }
  if (queryText) {
    const rawRule = await (deps.runRule || execFraudRuleScreen)({ text: queryText })
    rule = parseJson(rawRule) || rule
    const supplemental = supplementalRuleScreen(queryText)
    rule.score = Math.max(Number(rule.score || 0), supplemental.score)
    rule.hits = [...(rule.hits || []), ...supplemental.hits]
  }
  let ruleHits = normalizeRuleEvidence(rule)
  const linkChecks = []
  const detectedUrls = extractUrls(`${queryText}\n${context.currentUserMessage || ''}`)
  for (const url of detectedUrls) {
    const raw = await (deps.checkLink || execCheckLink)({ url })
    linkChecks.push({ url, ...(parseJson(raw) || { ok: false, error: 'invalid_link_result' }) })
  }

  let imageAnalysis = null
  let extractedText = ''
  if (imageRef) {
    const imageInput = imageRef.startsWith('data:image/') || /^https?:\/\//i.test(imageRef)
      ? { image_url: imageRef }
      : { image_path: imageRef }
    const raw = await (deps.analyzeImage || execAnalyzeFraudImage)(
      { ...imageInput, user_intent: '/risk_assess 诈骗风险研判', top_k: args.top_k ?? args.topK ?? 5 },
      {
        ...context,
        attachments,
        currentUserMessage: `${context.currentUserMessage || ''}\n${queryText}\n/risk_assess 诈骗风险研判\n${imageRef}`,
      },
    )
    imageAnalysis = parseJson(raw) || { ok: false, error: 'invalid_image_result' }
    extractedText = String(imageAnalysis.extracted_text || imageAnalysis.vision?.extractedText || '').trim()
    const imageHits = normalizeRuleEvidence(imageAnalysis.rule_engine || {})
    ruleHits = [...ruleHits, ...imageHits].filter((item, index, all) => all.findIndex(other => other.id && other.id === item.id) === index)
    for (const item of imageAnalysis.links?.checked || []) {
      if (!linkChecks.some(link => link.url === item.url)) linkChecks.push(item)
    }
  }

  const assessmentText = [queryText, extractedText].filter(Boolean).join('\n').slice(0, MAX_TEXT_LENGTH)
  const llmTriage = await runLlmTriage({
    text: assessmentText,
    ruleHits,
    linkChecks,
    lossStatus,
  }, deps.llmTriage || deps.callLLM)
  let rag = { ok: false, status: 'not_attempted', status_label: '未执行（缺少可检索文字）', error: null }
  let similarCases = []
  const searchCases = deps.searchCases || searchRiskTexts
  const readiness = deps.getReadiness || getRagReadiness
  if (assessmentText) {
    try {
      const ready = await readiness()
      rag = {
        ok: ready.ready !== false,
        status: ready.ready === false ? 'not_ready' : 'ready',
        status_label: ready.ready === false ? 'RAG 不可用，已尝试联网案例' : 'RAG 已连接',
        details: ready,
        error: ready.ready === false ? ready.status : null,
      }
    } catch (error) {
      rag = { ok: false, status: 'unavailable', status_label: 'RAG 不可用，已尝试联网案例', error: error?.message || 'RAG unavailable' }
    }
    if (rag.ok) {
      try {
        const result = await searchCases({ queryText: assessmentText, topK: args.top_k ?? args.topK ?? 5, candidateK: 50 })
        similarCases = normalizeCases(result?.items, 'rag')
      } catch (error) {
        rag = { ...rag, ok: false, status: 'search_failed', status_label: 'RAG 不可用，已尝试联网案例', error: error?.message || 'RAG search failed' }
      }
    }
  }

  let web = { ok: false, attempted: false, error: null, cases: [] }
  if (!rag.ok || similarCases.length === 0) {
    web.attempted = true
    try {
      const raw = await (deps.webSearch || execWebSearch)({
        query: `反诈案例 ${assessmentText.slice(0, 180)}`,
        limit: 8,
      }, context)
      const result = parseJson(raw) || {}
      web = {
        ok: result.ok === true,
        attempted: true,
        error: result.ok === true ? null : (result.message || result.error || 'web search failed'),
        cases: officialWebCases(result).map(item => ({
          title: item.title,
          url: item.url,
          snippet: item.snippet,
        })),
      }
      if (similarCases.length === 0 && web.cases.length) similarCases = normalizeCases(web.cases, 'web')
    } catch (error) {
      web.error = error?.message || 'web search failed'
    }
    if (!similarCases.length && rag.ok) rag = { ...rag, status_label: 'RAG 已连接，但未找到相似案例；联网案例不可用' }
  }
  if (!rag.ok && !web.cases.length) {
    rag.status_label = 'RAG 不可用，联网案例也不可用，已使用规则结果'
  } else if (!rag.ok && web.cases.length) {
    rag.status_label = 'RAG 不可用，已使用联网权威案例'
  } else if (web.cases.length && !similarCases.some(item => item.source === 'rag')) {
    rag.status_label = 'RAG 无匹配，已使用联网权威案例'
  }

  const linkScores = linkChecks.map(item => item.risk_score ?? item.risk?.score ?? (item.safety_score != null ? 100 - Number(item.safety_score) : 0))
  const score = clamp(Math.max(
    Number(rule.score || 0),
    Number(imageAnalysis?.risk?.score || 0),
    Number(llmTriage?.score || 0),
    ...linkScores,
  ))
  const riskLevel = levelFromScore(score, lossStatus)
  const fraudType = ruleHits[0]?.type
    || imageAnalysis?.rule_engine?.hits?.[0]?.type
    || llmTriage?.fraud_type
    || '暂未识别具体类型'
  const suspiciousPoints = uniqueText([
    ...collectSuspiciousPoints(ruleHits, linkChecks, imageAnalysis?.vision),
    ...(llmTriage?.suspicious_points || []),
  ], 8)
  const actions = buildActions(riskLevel, lossStatus)
  const result = {
    ok: true,
    tool: 'assess_fraud_risk',
    risk: {
      level: riskLevel,
      label: levelLabel(riskLevel),
      score,
      confidence: assessmentText || imageAnalysis?.ok ? 'supported' : 'insufficient_evidence',
    },
    risk_level: riskLevel,
    risk_score: score,
    fraud_type: fraudType,
    suspicious_points: suspiciousPoints,
    llm_triage: llmTriage ? {
      used: true,
      score: llmTriage.score,
      summary: llmTriage.summary,
    } : { used: false },
    evidence: {
      rules: ruleHits,
      rule_summary: rule.summary || imageAnalysis?.rule_engine?.summary || '',
      image: imageAnalysis ? {
        ok: imageAnalysis.ok === true,
        type: imageAnalysis.vision?.imageType || 'unknown',
        extracted_text: extractedText,
        uncertainties: imageAnalysis.vision?.uncertainties || [],
      } : null,
    },
    similar_cases: similarCases.slice(0, MAX_CASES),
    rag,
    web_search: web,
    links: {
      detected: [...new Set([...detectedUrls, ...extractUrls(extractedText)])].slice(0, MAX_LINKS),
      checked: linkChecks.slice(0, MAX_LINKS),
    },
    immediate_actions: actions.immediate,
    prevention_actions: actions.prevention,
    loss_status: lossStatus,
    qr_code: {
      detected: imageAnalysis?.vision?.imageType === 'qr_code' || (imageAnalysis?.vision?.entities?.qr_codes || []).length > 0,
      decoded: (imageAnalysis?.vision?.entities?.qr_codes || []).length > 0,
      note: imageAnalysis?.vision?.imageType === 'qr_code' && !(imageAnalysis?.vision?.entities?.qr_codes || []).length
        ? '二维码内容未能解码，不能判断为安全；请勿直接扫码。'
        : null,
    },
  }
  result.case_report = ['high', 'critical'].includes(riskLevel)
    ? buildCaseReportTemplate(result, {
      sourceText: assessmentText,
      attachments,
      channel: context.currentChannel || context.channel || '',
    })
    : null
  result.llm_summary = llmTriage?.summary || ''
  result.assessment_summary = buildAssessmentSummary(result)
  result.report = buildConciseReport(result)
  result.wechat_report = buildWechatReport(result)
  result.record_id = saveRecord(result, assessmentText, Date.now() - startedAt)
  emitEvent('risk_assessment', {
    tool: result.tool,
    level: riskLevel,
    score,
    loss_status: lossStatus,
    record_id: result.record_id,
  })
  return result
}

export async function execAssessFraudRisk(args = {}, context = {}) {
  try {
    const result = await runAssessFraudRisk(args, context, {
      callLLM: context.callLLM,
    })
    return JSON.stringify(result, null, 2)
  } catch (error) {
    return JSON.stringify({
      ok: false,
      tool: 'assess_fraud_risk',
      error: error?.code || 'RISK_ASSESSMENT_ERROR',
      message: error?.message || '诈骗风险研判失败',
    }, null, 2)
  }
}

export {
  buildCaseReportTemplate,
  buildWechatReport,
  extractUrls,
  normalizeLlmSummary,
  normalizeLossStatus,
}
