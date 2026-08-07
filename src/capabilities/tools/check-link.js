// =============================================================================
// 验链接工具：check_link
//
// 供 LLM / 斜杠指令 /check_link 直接调用，对单个 URL 做**本地零依赖**的安全研判：
//   - URL 解析与归一化（补协议、去空白、IDN/punycode、userinfo、端口、路径/参数）
//   - 形近域名 typosquatting（与知名品牌注册域做编辑距离比对）
//   - 同形字符 homoglyph（西里尔 / 希腊 / 全角字母冒充 ASCII）
//   - URL 缩短器（bit.ly / t.cn / dwz.cn ...）
//   - 裸 IP（IPv4 / IPv6，尤其 http://）
//   - 可疑 TLD（.tk / .ml / .top / .xyz ...）
//   - 诱导词（login / verify / 登录 / 验证码 / 中奖 / 红包 ...）
//   - 品牌滥用黑名单（子域冒用、品牌前缀诈骗域）
//
// 设计原则：
//   1. 纯函数 + 零外部依赖（不联网、不读配置），可被 LLM 工具、研判预分析层、单测直接调用。
//   2. 可选 LLM 研判层（`llm: true` 时启用）必须 try/catch 降级：LLM key 余额不足(402)
//      或任何异常都不影响本地启发式结论，仅以 `llm_analysis` 字段补充或置空。
//   3. 输出结构化结果 + 人读报告（report），方便直接投影 / 渲染。
// =============================================================================

import { runFraudRuleEngine } from '../../context/fraud-rule-engine.js'
import { domainToUnicode } from 'node:url'
import crypto from 'node:crypto'
import { createAnalysisRecord } from '../../services/analysis-record-service.js'

// -----------------------------------------------------------------------------
// 数据：品牌、缩短器、可疑 TLD、诱导词、同形字符
// -----------------------------------------------------------------------------

// 知名品牌「注册域」或「品牌关键词」——用于形近 / 冒用检测。
//   domain：官方注册域（用于编辑距离比对）
//   keywords：品牌词（含中文），用于子域冒用 / 关键词命中检测
const BRAND_ENTRIES = [
  { name: '淘宝', domain: 'taobao.com', keywords: ['淘宝', 'taobao'] },
  { name: '天猫', domain: 'tmall.com', keywords: ['天猫', 'tmall'] },
  { name: '京东', domain: 'jd.com', keywords: ['京东', 'jd', 'jingdong'] },
  { name: '支付宝', domain: 'alipay.com', keywords: ['支付宝', 'alipay', 'zhifubao'] },
  { name: '阿里', domain: 'alibaba.com', keywords: ['alibaba', '1688', '阿里巴巴'] },
  { name: '拼多多', domain: 'pinduoduo.com', keywords: ['拼多多', 'pinduoduo', 'pdd'] },
  { name: '微信', domain: 'weixin.qq.com', keywords: ['微信', 'weixin', 'wechat'] },
  { name: 'QQ', domain: 'qq.com', keywords: ['qq', 'tencent', '腾讯'] },
  { name: '腾讯', domain: 'tencent.com', keywords: ['tencent', '腾讯'] },
  { name: '工商银行', domain: 'icbc.com.cn', keywords: ['工行', '工银', 'icbc', '95588'] },
  { name: '建设银行', domain: 'ccb.com', keywords: ['建行', 'ccb', '95533'] },
  { name: '农业银行', domain: 'abchina.com', keywords: ['农行', 'abc', '95599', '农业银行'] },
  { name: '中国银行', domain: 'boc.cn', keywords: ['中行', 'boc', '95566', '中国银行'] },
  { name: '交通银行', domain: 'bankcomm.com', keywords: ['交行', 'bankcomm', '95559', '交通银行'] },
  { name: '招商银行', domain: 'cmbchina.com', keywords: ['招行', 'cmbchina', '95555', '招商'] },
  { name: '银联', domain: 'unionpay.com', keywords: ['银联', 'unionpay', '95516'] },
  { name: '中国移动', domain: '10086.cn', keywords: ['移动', '10086', 'chinamobile'] },
  { name: '中国铁路', domain: '12306.cn', keywords: ['12306', '铁路', '铁路12306'] },
  { name: '政府', domain: 'gov.cn', keywords: ['公安', '反诈', '银监会', 'gov'] },
  { name: 'PayPal', domain: 'paypal.com', keywords: ['paypal'] },
  { name: 'Apple', domain: 'apple.com', keywords: ['apple', 'icloud'] },
  { name: 'Microsoft', domain: 'microsoft.com', keywords: ['microsoft', 'live.com', 'outlook'] },
  { name: 'Google', domain: 'google.com', keywords: ['google', 'gmail'] },
  { name: 'Amazon', domain: 'amazon.com', keywords: ['amazon'] },
  { name: 'Facebook', domain: 'facebook.com', keywords: ['facebook', 'meta'] },
  { name: '美团', domain: 'meituan.com', keywords: ['美团', 'meituan', '大众点评', 'dianping'] },
  { name: '百度', domain: 'baidu.com', keywords: ['百度', 'baidu'] },
]

// 常见 URL 缩短器域名。
const SHORTENER_DOMAINS = new Set([
  'bit.ly', 't.cn', 'dwz.cn', 'suo.im', 'url.cn', 'tinyurl.com', 'goo.gl',
  'is.gd', 'cutt.ly', 'ow.ly', 'buff.ly', 'shorturl.at', 'rb.gy', 'rebrand.ly',
  '0x0.st', 'sina.lt', 'dwz.win', 't.im',
])

// 可疑 / 高风险 TLD（免费或常被钓鱼滥用）。
const SUSPICIOUS_TLDS = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'ru', 'su', 'click', 'link',
  'country', 'stream', 'science', 'work', 'date', 'racing', 'review', 'download',
  'loan', 'win', 'rest', 'support', 'accountant', 'gdn', 'jetzt', 'online',
  'live', 'host', 'party', 'racing', 'agency', 'bid', 'cricket', 'download',
  'faith', 'gq', 'kim', 'men', 'pw', 'red', 'repo', 'webcam', 'website', 'zone',
])

// 诱导词 / 钓鱼话术常见英文 token（按词比对）。
const INDUCED_WORDS_EN = [
  'login', 'log-in', 'signin', 'sign-in', 'verify', 'verification', 'account',
  'password', 'secure', 'security', 'bank', 'banking', 'update', 'confirm',
  'webscr', 'paypal', 'redeem', 'unlock', 'authenticate', 'otp', 'token',
  'reset', 'recover', 'support', 'service', 'claim', 'prize', 'gift', 'bonus',
  'customer', 'limited', 'urgent', 'suspend', 'expire', 'wallet', 'crypto',
  'binance', 'coinbase', 'metamask', 'airdrop', 'free',
]

// 诱导词（中文）——命中即判为高风险诱导。
const INDUCED_WORDS_ZH = [
  '登录', '登陆', '验证', '验证码', '核验', '安全', '密码', '提现', '解冻',
  '客服', '退款', '理赔', '中奖', '红包', '领取', '激活', '账户', '银行卡',
  '实名', '认证', '刷单', '返利', '佣金', '授权', '紧急', '失效', '冻结',
  '公安', '通缉', '安全账户', '资金审查', '取消会员', '误开通',
]

// 同形字符映射：键为「看起来像 ASCII 的非 ASCII 字符」，值为其 ASCII 等价物。
const KNOWN_HOMOGLYPHS = {
  // 西里尔
  'а': 'a', 'е': 'e', 'о': 'o', 'с': 'c', 'р': 'p', 'х': 'x', 'у': 'y',
  'і': 'i', 'ј': 'j', 'ԁ': 'd', 'ԃ': 'd', 'ѡ': 'w', 'ԍ': 'g', 'ӏ': 'l',
  'ԉ': 'n', 'ԟ': 'k', 'ԛ': 'q', 'ҵ': 'z', 'һ': 'h', 'ӏ': 'l',
  // 希腊
  'ρ': 'p', 'ν': 'v', 'μ': 'u', 'ι': 'i', 'ο': 'o', 'ε': 'e', 'α': 'a',
  'κ': 'k', 'τ': 't', 'η': 'n', 'χ': 'x', 'γ': 'y', 'β': 'b', 'ζ': 'z',
  // 全角拉丁（兼容型，常出现在钓鱼）
  'Ａ': 'A', 'Ｂ': 'B', 'Ｃ': 'C', 'Ｅ': 'E', 'Ｇ': 'G', 'Ｈ': 'H', 'Ｉ': 'I',
  'Ｊ': 'J', 'Ｋ': 'K', 'Ｌ': 'L', 'Ｍ': 'M', 'Ｎ': 'N', 'Ｏ': 'O', 'Ｐ': 'P',
  'Ｑ': 'Q', 'Ｒ': 'R', 'Ｓ': 'S', 'Ｔ': 'T', 'Ｕ': 'U', 'Ｖ': 'V', 'Ｗ': 'W',
  'Ｘ': 'X', 'Ｙ': 'Y', 'Ｚ': 'Z',
  'ａ': 'a', 'ｂ': 'b', 'ｃ': 'c', 'ｄ': 'd', 'ｅ': 'e', 'ｆ': 'f', 'ｇ': 'g',
  'ｈ': 'h', 'ｉ': 'i', 'ｊ': 'j', 'ｋ': 'k', 'ｌ': 'l', 'ｍ': 'm', 'ｎ': 'n',
  'ｏ': 'o', 'ｐ': 'p', 'ｑ': 'q', 'ｒ': 'r', 'ｓ': 's', 'ｔ': 't', 'ｕ': 'u',
  'ｖ': 'v', 'ｗ': 'w', 'ｘ': 'x', 'ｙ': 'y', 'ｚ': 'z',
  'ɡ': 'g', 'ɡ': 'g',
}

// 常见「二级公共后缀」（注册域需取倒数第二段）。
const MULTI_SUFFIXES = new Set([
  'com.cn', 'com.hk', 'com.tw', 'com.br', 'com.au', 'co.uk', 'org.uk',
  'gov.cn', 'edu.cn', 'net.cn', 'org.cn', 'ac.cn', 'com.jp', 'co.jp',
  'ne.jp', 'or.jp', 'go.jp', 'co.nz', 'com.sg', 'com.mx',
])

// -----------------------------------------------------------------------------
// 工具函数
// -----------------------------------------------------------------------------

/**
 * 编辑距离（Levenshtein）。用于形近域名检测。
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function levenshtein(a, b) {
  const m = String(a || '').length
  const n = String(b || '').length
  if (m === 0) return n
  if (n === 0) return m
  let prev = new Array(n + 1)
  let curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[n]
}

/**
 * 把常见字符归一化的「易混淆」形式（o→0, l→1, i→1 等），用于形近比对容错。
 * @param {string} s
 * @returns {string}
 */
function normalizeForTypo(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[o0]/g, 'o')
    .replace(/[i1l!|]/g, 'i')
    .replace(/[s5$]/g, 's')
    .replace(/[b8]/g, 'b')
    .replace(/[g6]/g, 'g')
    .replace(/[z2]/g, 'z')
    .replace(/[-_.]/g, '')
}

/**
 * 检测字符串里是否含同形字符，并返回映射后的 ASCII 近似串。
 * @param {string} s
 * @returns {{ has: boolean, ascii: string, hits: string[] }}
 */
function scanHomoglyph(s) {
  let has = false
  const hits = []
  let ascii = ''
  for (const ch of String(s || '')) {
    if (KNOWN_HOMOGLYPHS[ch]) {
      has = true
      hits.push(`${ch}→${KNOWN_HOMOGLYPHS[ch]}`)
      ascii += KNOWN_HOMOGLYPHS[ch]
    } else {
      ascii += ch
    }
  }
  return { has, ascii, hits: [...new Set(hits)] }
}

/**
 * 解析并归一化 URL。尽力而为，非法也返回尽量完整的结构。
 * @param {string} raw
 * @returns {Object}
 */
function normalizeUrl(raw) {
  const original = String(raw || '').trim()
  const fallback = {
    url: original, protocol: '', host: '', hostname: '', port: '',
    path: '', query: '', fragment: '', isIp: false, ipVersion: 0,
    domain: '', registrableDomain: '', subdomain: '', tld: '',
    hasUserinfo: false, punycode: false, error: 'empty',
  }
  if (!original) return fallback

  // 提取首个看似 URL 的片段（用户可能粘贴带前后文字）。
  const extracted = original.match(/https?:\/\/[^\s"'<>]+|[a-z0-9-]+(\.[a-z0-9-]+)+[^\s"'<>]*/i)
  const candidate = extracted ? extracted[0] : original

  let withScheme = candidate
  if (!/^[a-z][a-z0-9+.-]*:/i.test(withScheme)) {
    withScheme = `https://${withScheme}`
  }

  let url
  try {
    url = new URL(withScheme)
  } catch {
    return { ...fallback, url: candidate, error: 'invalid' }
  }

  const hostname = url.hostname || ''
  const hasUserinfo = Boolean(url.username || url.password)

  // 裸 IP 检测
  let isIp = false
  let ipVersion = 0
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    isIp = hostname.split('.').every(o => Number(o) >= 0 && Number(o) <= 255)
    if (isIp) ipVersion = 4
  } else if (hostname.startsWith('[') && hostname.endsWith(']')) {
    isIp = true
    ipVersion = 6
  }

  // 注册域（eTLD+1）近似提取
  const lowerHost = hostname.toLowerCase()
  let tld = ''
  let registrableDomain = ''
  let subdomain = ''
  const parts = lowerHost.split('.')
  const lastTwo = parts.slice(-2).join('.')
  if (MULTI_SUFFIXES.has(lastTwo) && parts.length >= 3) {
    tld = lastTwo
    registrableDomain = parts.slice(-3).join('.')
    subdomain = parts.slice(0, -3).join('.')
  } else if (parts.length >= 2) {
    tld = parts[parts.length - 1]
    registrableDomain = parts.slice(-2).join('.')
    subdomain = parts.slice(0, -2).join('.')
  } else {
    tld = parts[parts.length - 1] || ''
    registrableDomain = lowerHost
  }

  return {
    url: url.href,
    protocol: url.protocol.replace(':', ''),
    host: url.host,
    hostname: lowerHost,
    // 解码 punycode 后的 Unicode 主机名：URL 构造器会把同形字符转成 xn--，
    // 同形检测必须作用在「解码后」的 Unicode 上，否则永远命中不到。
    unicodeHostname: domainToUnicode(hostname || '').toLowerCase(),
    port: url.port || (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : ''),
    path: decodeURIComponent(url.pathname || ''),
    query: url.search || '',
    fragment: url.hash || '',
    isIp,
    ipVersion,
    domain: lowerHost,
    registrableDomain,
    subdomain,
    tld: tld.replace(/^xn--/, ''),
    hasUserinfo,
    punycode: hostname.includes('xn--'),
    error: '',
  }
}

/**
 * 风险分 → 风险等级（与 fraud-rule-engine 分档一致）。
 * @param {number} score
 * @returns {string}
 */
function levelFromScore(score) {
  if (score >= 90) return '高危钓鱼'
  if (score >= 70) return '高风险'
  if (score >= 50) return '中风险'
  if (score >= 30) return '低风险'
  return '安全'
}

const SEVERITY_WEIGHT = { high: 35, medium: 20, low: 10, info: 4 }

function pushFinding(findings, type, severity, label, detail, weight) {
  findings.push({
    type,
    severity,
    label,
    detail,
    ...(typeof weight === 'number' ? { weight } : {}),
  })
}

// -----------------------------------------------------------------------------
// 核心：单 URL 启发式分析
// -----------------------------------------------------------------------------

/**
 * 对单个 URL 做本地启发式安全研判。
 * @param {string|Object} input  URL 字符串，或 { url | link | text }
 * @param {Object} [opts]
 * @param {boolean} [opts.llm]  是否启用可选 LLM 研判层（默认 false）。
 * @returns {Promise<Object>} 结构化研判结果
 */
export async function analyzeUrl(input, opts = {}) {
  const raw = typeof input === 'string'
    ? input
    : (input?.url || input?.link || input?.url_text || input?.text || '')
  const findings = []
  const normalized = normalizeUrl(raw)

  if (normalized.error) {
    return {
      ok: false,
      tool: 'check_link',
      url: raw,
      error: `无法解析的链接：${normalized.error}`,
      risk_score: 0,
      risk_level: '安全',
      findings: [{ type: 'invalid', severity: 'info', label: '链接无法解析', detail: normalized.error }],
      report: `无法解析该链接（${normalized.error}），请确认格式是否正确。`,
      advice: ['请确认链接完整（含协议与域名）', '警惕被截断或带乱码的链接'],
    }
  }

  // 1) 同形字符 homoglyph（作用在解码后的 Unicode 主机名，避开 punycode 归一化绕过）
  const homo = scanHomoglyph(normalized.unicodeHostname)
  if (homo.has) {
    pushFinding(
      findings, 'homoglyph', 'high', '同形字符冒充',
      `域名含疑似同形字符（非 ASCII 伪装）： ${homo.hits.join('，')}。解码后近似「${homo.ascii}」。`,
    )
  }

  // 2) 裸 IP
  if (normalized.isIp) {
    pushFinding(
      findings, 'bare_ip', 'high', '裸 IP 地址',
      `主机为${normalized.ipVersion === 6 ? 'IPv6' : 'IPv4'}裸地址，正规服务极少直接用 IP 暴露给用户，常见于钓鱼 / 仿冒。`,
    )
  }

  // 3) 可疑 TLD
  if (SUSPICIOUS_TLDS.has(normalized.tld)) {
    pushFinding(
      findings, 'suspicious_tld', 'medium', '可疑 TLD',
      `使用了常被钓鱼滥用的后缀 .${normalized.tld}。`,
    )
  }

  // 4) URL 缩短器
  if (SHORTENER_DOMAINS.has(normalized.registrableDomain)) {
    pushFinding(
      findings, 'shortener', 'medium', 'URL 缩短器',
      `使用了短链域名 ${normalized.registrableDomain}，真实目标被隐藏，难以直接判断安全性。`,
    )
  }

  // 5) userinfo（user@host 钓鱼）
  if (normalized.hasUserinfo) {
    pushFinding(
      findings, 'userinfo', 'high', 'URL 内嵌账号',
      `链接中包含了 userinfo（形如 user@host），常见于伪造「官方账号@域名」的钓鱼伎俩。`,
    )
  }

  // 6) punycode / IDN
  if (normalized.punycode) {
    // 单独一个 IDN 域也应至少进入「低风险」（权重 30），提示用户人工核实；
    // 若解码后还含有同形字符，则叠加上面的 homoglyph 高危项。
    pushFinding(
      findings, 'idn', 'low', '国际化域名(IDN)',
      `域名含 punycode 编码（xn--），可能是 IDN 同形异义域名攻击，需解码后人工确认。`,
      30,
    )
  }

  // 7) 形近域名 / 品牌冒用
  const regNorm = normalizeForTypo(normalized.registrableDomain)
  const subNorm = normalizeForTypo(normalized.subdomain)
  let brandHit = null
  for (const brand of BRAND_ENTRIES) {
    // 注册域与品牌域编辑距离
    const dReg = levenshtein(regNorm, normalizeForTypo(brand.domain))
    if (dReg >= 1 && dReg <= 2 && regNorm.length > 0) {
      brandHit = { brand: brand.name, domain: brand.domain, kind: 'typosquat', distance: dReg }
      break
    }
    // 子域冒用（品牌词出现在子域，但注册域不同）
    for (const kw of brand.keywords) {
      const kwN = normalizeForTypo(kw)
      if (!kwN) continue
      if (subNorm.includes(kwN) && !regNorm.includes(kwN)) {
        brandHit = { brand: brand.name, domain: brand.domain, kind: 'subdomain_abuse', keyword: kw }
        break
      }
      // 注册域以品牌词为前缀 + 额外后缀（如 taobao-login.com），但排除官方域名本身
      if (regNorm.startsWith(kwN) && regNorm.length > kwN.length + 1 && !regNorm.endsWith(kwN)
          && regNorm !== normalizeForTypo(brand.domain)) {
        brandHit = { brand: brand.name, domain: brand.domain, kind: 'brand_prefix', keyword: kw }
        break
      }
    }
    if (brandHit) break
  }
  if (brandHit) {
    const detailMap = {
      typosquat: `注册域与官方「${brandHit.domain}」编辑距离为 ${brandHit.distance}，疑似形近域名（typosquatting）欺骗。`,
      subdomain_abuse: `子域中出现品牌词「${brandHit.keyword}」但注册域并非官方，属子域冒用。`,
      brand_prefix: `注册域以品牌词「${brandHit.keyword}」为前缀拼接后缀，疑似仿冒官方域名。`,
    }
    pushFinding(
      findings, 'brand_impersonation', 'high', `疑似冒充「${brandHit.brand}」`,
      detailMap[brandHit.kind] || '命中品牌冒用模式。',
    )
  }

  // 8) 诱导词（路径 / 参数 / 片段）
  const lowerTail = `${normalized.path} ${normalized.query} ${normalized.fragment}`.toLowerCase()
  const hitEn = INDUCED_WORDS_EN.filter(w => lowerTail.includes(w.toLowerCase()))
  const hitZh = INDUCED_WORDS_ZH.filter(w => (normalized.path + normalized.query + normalized.fragment).includes(w))
  if (hitEn.length || hitZh.length) {
    pushFinding(
      findings, 'induce_words', 'medium', '含诱导/钓鱼话术词',
      `路径或参数中出现诱导词：${[...hitZh, ...hitEn].slice(0, 12).join('，')}。`,
    )
  }

  // 9) 明文 http
  if (normalized.protocol === 'http') {
    pushFinding(
      findings, 'plain_http', 'low', '明文 HTTP',
      `使用 http:// 明文传输，账号/验证码等敏感信息易被窃听，正规登陆页通常为 https。`,
    )
  }

  // 10) 域名过长 / 多子域（堆叠混淆）
  if (normalized.hostname.split('.').length >= 5) {
    pushFinding(
      findings, 'subdomain_stacking', 'low', '子域层级过多',
      `子域层级达 ${normalized.hostname.split('.').length} 层，可能是用多层子域混淆真实主机。`,
    )
  }

  // 汇总风险分（允许单条通过 weight 覆盖默认严重度权重）
  let score = 0
  for (const f of findings) {
    score += (typeof f.weight === 'number' ? f.weight : SEVERITY_WEIGHT[f.severity] || 0)
  }
  score = Math.min(100, score)
  const level = levelFromScore(score)

  // 可选 LLM 研判层（try/catch 降级）
  let llmAnalysis = null
  let llmNote = ''
  if (opts.llm) {
    try {
      llmAnalysis = await runLinkLLMAnalysis(normalized.url, findings)
    } catch (err) {
      llmNote = `LLM 研判层不可用，已降级为本地启发式结论：${err?.message || 'unknown'}`
    }
  }

  const advice = buildAdvice(findings, level)

  return {
    ok: true,
    tool: 'check_link',
    url: normalized.url,
    input: raw,
    normalized: {
      protocol: normalized.protocol,
      host: normalized.host,
      registrable_domain: normalized.registrableDomain,
      subdomain: normalized.subdomain,
      tld: normalized.tld,
      is_ip: normalized.isIp,
      has_userinfo: normalized.hasUserinfo,
    },
    risk_score: score,
    risk_level: level,
    findings,
    advice,
    llm_analysis: llmAnalysis,
    llm_note: llmNote,
    report: buildLinkReport({ raw, normalized, score, level, findings, advice, llmAnalysis, llmNote }),
  }
}

// -----------------------------------------------------------------------------
// 处置建议 & 报告渲染（复用「结构化风险拆解」风格）
// -----------------------------------------------------------------------------

/**
 * 根据命中的风险项生成处置建议。
 * @param {Array} findings
 * @param {string} level
 * @returns {string[]}
 */
function buildAdvice(findings, level) {
  const advice = []
  if (level === '安全') {
    advice.push('本地启发式未检出明显风险，但仍建议核对域名是否与官方一致。')
  } else {
    advice.push('请勿在该页面输入账号、密码、短信验证码或银行卡信息。')
    advice.push('通过官方 App / 官方客服电话核实，而非点击链接内提供的联系方式。')
  }
  for (const f of findings) {
    if (f.type === 'brand_impersonation') {
      advice.push('这是最危险的一类：冒充官方域名的钓鱼链接，直接关闭页面。')
    }
    if (f.type === 'bare_ip') advice.push('正规服务几乎不会用裸 IP 提供登陆页，立即关闭。')
    if (f.type === 'shortener') advice.push('短链目标被隐藏，展开前不要轻信，必要时用其他渠道核实。')
    if (f.type === 'userinfo') advice.push('含 user@host 的链接几乎都是伪造，直接丢弃。')
  }
  advice.push('遇诈骗或已泄露信息，请拨打 96110（反诈专线）或 110。')
  return [...new Set(advice)]
}

/**
 * 生成人读报告（markdown 风格纯文本）。
 * @param {Object} p
 * @returns {string}
 */
function buildLinkReport(p) {
  const { raw, normalized, score, level, findings, advice, llmAnalysis, llmNote } = p
  const lines = []
  lines.push(`【验链接结果】风险等级：${level}（风险分 ${score}/100）`)
  lines.push('')
  lines.push(`原始链接：${raw}`)
  lines.push(`归一化 ：${normalized.url}`)
  if (normalized.registrable_domain) lines.push(`注册域  ：${normalized.registrable_domain}（TLD .${normalized.tld}）`)
  lines.push('')
  if (findings.length === 0) {
    lines.push('检出项：无。本地启发式未识别到已知钓鱼特征。')
  } else {
    lines.push(`检出项（${findings.length}）：`)
    for (const f of findings) {
      const sev = { high: '高危', medium: '中危', low: '低危', info: '提示' }[f.severity] || f.severity
      lines.push(`· [${sev}] ${f.label}`)
      lines.push(`  ${f.detail}`)
    }
  }
  lines.push('')
  lines.push('处置建议：')
  for (const a of advice) lines.push(`· ${a}`)
  if (llmAnalysis) {
    lines.push('')
    lines.push('LLM 研判补充：')
    lines.push(typeof llmAnalysis === 'string' ? llmAnalysis : JSON.stringify(llmAnalysis))
  } else if (llmNote) {
    lines.push('')
    lines.push(`（${llmNote}）`)
  }
  return lines.join('\n')
}

// -----------------------------------------------------------------------------
// 可选 LLM 研判层（lazy import + try/catch 降级）
// -----------------------------------------------------------------------------

/**
 * 可选 LLM 研判：对已归一化的链接做更深度的意图/风险研判。
 * 仅在 opts.llm 为真时调用；任何异常（含 402 余额不足）向上抛出由调用方降级。
 * @param {string} url
 * @param {Array} findings
 * @returns {Promise<string>}
 */
async function runLinkLLMAnalysis(url, findings) {
  // 延迟引入主模型客户端，避免零依赖启发式路径被打重依赖拖慢。
  const { callLLM } = await import('../../llm.js').catch(() => ({ callLLM: null }))
  if (typeof callLLM !== 'function') {
    throw new Error('LLM client unavailable')
  }
  const signal = AbortSignal.timeout(15000)
  const result = await callLLM({
    systemPrompt:
      '你是反钓鱼安全分析师。仅基于所给 URL 与已检出的本地特征，用 2-4 句中文评估该链接的可能诈骗意图与处置优先级。不要编造事实，不要访问网络。',
    message: `URL: ${url}\n本地检出特征: ${JSON.stringify(findings.map(f => ({ type: f.type, label: f.label })))}`,
    tools: [],
    temperature: 0.2,
    maxTokens: 240,
    thinking: false,
    mustReply: true,
    signal,
  })
  return (result && result.content) ? String(result.content).trim() : ''
}

// -----------------------------------------------------------------------------
// 工具入口（executor 调用）
// -----------------------------------------------------------------------------

/**
 * 验链接工具入口，返回 JSON 字符串（与项目其它 fraud 工具一致）。
 * @param {string|Object} args  URL 字符串或 { url, link, text, llm }
 * @returns {Promise<string>}
 */
export async function execCheckLink(args = {}) {
  try {
    const llm = Boolean(typeof args === 'object' ? args.llm : false)
    const result = await analyzeUrl(args, { llm })
    // 若文本里还夹带话术，顺带跑一次规则引擎，作为辅助信号（非阻断）。
    const urlText = typeof args === 'string' ? args : (args?.text || args?.url || '')
    if (urlText) {
      try {
        const rule = runFraudRuleEngine(urlText)
        if (rule && rule.score >= 30) {
          result.fraud_rule_hint = { score: rule.score, level: rule.level, top: rule.hits[0]?.type || null }
        }
      } catch { /* 规则引擎为辅助信号，失败不阻断 */ }
    }
    const url = typeof args === 'string'
      ? args
      : (args?.url || args?.link || args?.text || '')
    const record = createAnalysisRecord({
      inputSummary: String(result.report || url).slice(0, 300),
      inputHash: crypto.createHash('sha256').update(String(url || '')).digest('hex'),
      fraudType: '链接诈骗分析',
      riskLevel: result.risk_level === '高危钓鱼' || result.risk_level === '高风险' ? 'high'
        : result.risk_level === '中风险' ? 'medium'
        : 'low',
      rulesHit: result.findings || [],
      modelUsed: llm ? 'llm+heuristic' : 'heuristic',
      latencyMs: null,
      alertSent: false,
      feedback: null,
      source: 'check_link',
      analysisKind: 'link',
      subjectKind: 'url',
      subjectRef: subjectRefFromUrl(url),
      toolName: 'check_link',
      analysisStatus: llm && !result.llm_analysis ? 'partial' : 'done',
      failureReason: result.llm_note || '',
      reportMarkdown: result.report || '',
    })
    return JSON.stringify({ ok: true, record_id: record.recordId, ...result }, null, 2)
  } catch (error) {
    try {
      const url = typeof args === 'string'
        ? args
        : (args?.url || args?.link || args?.text || '')
      const record = createAnalysisRecord({
        inputSummary: String(url || '链接分析失败').slice(0, 300),
        inputHash: crypto.createHash('sha256').update(String(url || '')).digest('hex'),
        fraudType: '链接诈骗分析',
        riskLevel: 'low',
        rulesHit: [],
        modelUsed: 'check_link',
        source: 'check_link',
        analysisKind: 'link',
        subjectKind: 'url',
        subjectRef: subjectRefFromUrl(url),
        toolName: 'check_link',
        analysisStatus: 'failed',
        failureReason: error?.message || '验链接失败',
        reportMarkdown: '',
      })
      return JSON.stringify({
        ok: false,
        tool: 'check_link',
        record_id: record.recordId,
        error: error?.code || 'CHECK_LINK_ERROR',
        message: error?.message || '验链接失败',
      }, null, 2)
    } catch (persistError) {
      return JSON.stringify({
        ok: false,
        tool: 'check_link',
        error: error?.code || 'CHECK_LINK_ERROR',
        message: error?.message || '验链接失败',
        record_error: persistError?.message || 'analysis record persist failed',
      }, null, 2)
    }
  }
}

function subjectRefFromUrl(url = '') {
  const hash = crypto.createHash('sha256').update(String(url || '')).digest('hex')
  return `url:${hash.slice(0, 16)}`
}

export const CHECK_LINK_VERSION = '1.0.0'
