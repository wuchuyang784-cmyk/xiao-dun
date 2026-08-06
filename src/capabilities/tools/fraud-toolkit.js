// 反诈工具箱：report_fraud / search_law / check_qrcode / verify_identity
//
// 四个独立工具，覆盖举报指引、法规检索、二维码分析、综合身份核实。
// 全部使用本地数据 + 规则引擎，不依赖 RAG 服务，离线可用。

import { runFraudRuleEngine, FRAUD_RULE_ENGINE_VERSION } from '../../context/fraud-rule-engine.js'

function toolJson(obj, ok = true) {
  return JSON.stringify({ ok, ...obj }, null, 2)
}

// ─── 1. report_fraud: 一键举报指引 ────────────────────────────────────────────

const REPORT_CHANNELS = [
  {
    name: '96110 反诈专线',
    number: '96110',
    description: '全国统一的预警劝阻专用号码。接到此号码来电务必接听。',
    suitable_for: '所有诈骗类型预警、咨询、劝阻',
  },
  {
    name: '110 报警电话',
    number: '110',
    description: '紧急报警电话。遭遇诈骗后第一时间拨打。',
    suitable_for: '已造成财产损失的诈骗',
  },
  {
    name: '12321 网络不良信息举报',
    number: '12321',
    description: '举报垃圾短信、骚扰电话、不良网站、钓鱼链接。',
    suitable_for: '钓鱼网站、骚扰电话、垃圾短信、不良APP',
    online: 'https://www.12321.cn',
  },
  {
    name: '国家反诈中心 APP',
    description: '举报诈骗、检测可疑APP、拦截诈骗电话。',
    suitable_for: '所有诈骗类型举报与预警',
    features: ['来电预警', 'APP自查', '举报诈骗', '风险检测'],
  },
  {
    name: '网络违法犯罪举报网站',
    online: 'https://cyberpolice.mps.gov.cn',
    description: '公安部网络违法犯罪举报平台。',
    suitable_for: '网络诈骗、网络赌博、网络色情等网络犯罪',
  },
]

const EVIDENCE_TIPS = [
  '保存聊天记录截图（不要删除原始记录）',
  '保存转账/汇款凭证（银行流水、支付截图）',
  '记录对方账号信息（微信号、QQ号、电话号码、银行卡号）',
  '保存诈骗链接/二维码截图',
  '保存通话录音（如有）',
  '不要惊动骗子，避免对方删除证据',
]

const FRAUD_TYPE_GUIDE = {
  brushing: { name: '刷单返利', extra: '保留任务截图、返利记录、对方联系账号' },
  refund_customer: { name: '冒充客服退款', extra: '保留订单号、对方冒充的平台名称、退款链接截图' },
  impersonate_police: { name: '冒充公检法', extra: '记录对方自称的单位、案件编号、安全账户信息' },
  fake_investment: { name: '虚假投资理财', extra: '保留投资APP截图、转账记录、推荐人信息' },
  pig_butchering: { name: '杀猪盘', extra: '保留交友平台聊天记录、投资平台信息、转账凭证' },
  loan_scam: { name: '贷款诈骗', extra: '保留贷款平台信息、交费记录、对方联系方式' },
  general: { name: '通用', extra: '尽可能保留所有相关证据' },
}

export function execReportFraud(args = {}) {
  const fraudType = String(args.fraud_type || 'general').trim().toLowerCase()
  const description = String(args.description || '').trim()

  const guide = FRAUD_TYPE_GUIDE[fraudType] || FRAUD_TYPE_GUIDE.general
  const evidenceList = [...EVIDENCE_TIPS]
  if (guide.extra) evidenceList.push(guide.extra)

  return toolJson({
    fraud_type: fraudType,
    fraud_type_name: guide.name,
    channels: REPORT_CHANNELS.map(c => ({
      name: c.name,
      number: c.number || undefined,
      online: c.online || undefined,
      description: c.description,
      suitable_for: c.suitable_for,
      features: c.features || undefined,
    })),
    steps: [
      '1. 立即拨打 96110 反诈专线（如已转账，同时拨打 110 报警）',
      '2. 按照接线员指引，提供诈骗类型和涉案金额',
      '3. 在国家反诈中心 APP 中提交举报，上传证据截图',
      '4. 如涉及网络平台，到 12321 或网络违法犯罪举报网站补充举报',
      '5. 到就近派出所做笔录，提交书面证据材料',
    ],
    evidence_tips: evidenceList,
    hotline: '96110',
    reminder: description
      ? `你描述的情况涉及「${guide.name}」类诈骗。请尽快拨打 96110 或前往就近派出所。`
      : `请尽快拨打 96110 反诈专线。如已造成损失，立即拨打 110 报警。`,
  })
}

// ─── 2. search_law: 法规检索 ──────────────────────────────────────────────────

const LAW_DATABASE = [
  {
    title: '中华人民共和国反电信网络诈骗法',
    article: '第38条',
    content: '组织、策划、实施、参与电信网络诈骗活动或者为电信网络诈骗活动提供帮助，构成犯罪的，依法追究刑事责任。前款行为尚不构成犯罪的，由公安机关处十日以上十五日以下拘留，并处违法所得一倍以上十倍以下罚款，没有违法所得或者违法所得不足一万元的，处十万元以下罚款。',
    keywords: ['反诈法', '电信网络诈骗', '刑事责任', '行政拘留', '罚款', '组织', '策划', '实施', '帮助'],
    source: '2022年12月1日起施行',
  },
  {
    title: '中华人民共和国刑法',
    article: '第266条 诈骗罪',
    content: '诈骗公私财物，数额较大的，处三年以下有期徒刑、拘役或者管制，并处或者单处罚金；数额巨大或者有其他严重情节的，处三年以上十年以下有期徒刑，并处罚金；数额特别巨大或者有其他特别严重情节的，处十年以上有期徒刑或者无期徒刑，并处罚金或者没收财产。本法另有规定的，依照规定。',
    keywords: ['诈骗罪', '刑法266', '量刑', '有期徒刑', '罚金', '拘役', '管制', '数额较大', '数额巨大', '数额特别巨大'],
    source: '现行有效',
  },
  {
    title: '中华人民共和国刑法',
    article: '第266条之一 招摇撞骗罪',
    content: '冒充国家机关工作人员招摇撞骗的，处三年以下有期徒刑、拘役、管制或者剥夺政治权利；情节严重的，处三年以上十年以下有期徒刑。冒充人民警察招摇撞骗的，依照前款的规定从重处罚。',
    keywords: ['冒充', '招摇撞骗', '冒充国家机关', '冒充警察', '量刑'],
    source: '现行有效',
  },
  {
    title: '中华人民共和国刑法',
    article: '第253条之一 侵犯公民个人信息罪',
    content: '违反国家有关规定，向他人出售或者提供公民个人信息，情节严重的，处三年以下有期徒刑或者拘役，并处或者单处罚金；情节特别严重的，处三年以上七年以下有期徒刑，并处罚金。',
    keywords: ['个人信息', '侵犯公民信息', '出售信息', '提供信息', '量刑'],
    source: '现行有效',
  },
  {
    title: '中华人民共和国刑法',
    article: '第285条 非法获取计算机信息系统数据罪',
    content: '违反国家规定，侵入前款规定以外的计算机信息系统或者采用其他技术手段，获取该计算机信息系统中存储、处理或者传输的数据，情节严重的，处三年以下有期徒刑或者拘役，并处或者单处罚金；情节特别严重的，处三年以上七年以下有期徒刑，并处罚金。',
    keywords: ['黑客', '侵入系统', '非法获取数据', '计算机犯罪', '木马', '钓鱼'],
    source: '现行有效',
  },
  {
    title: '中华人民共和国刑法',
    article: '第286条 破坏计算机信息系统罪',
    content: '违反国家规定，对计算机信息系统功能进行删除、修改、增加、干扰，造成计算机信息系统不能正常运行，后果严重的，处五年以下有期徒刑或者拘役；后果特别严重的，处五年以上有期徒刑。',
    keywords: ['破坏系统', '计算机犯罪', '删除', '修改', '干扰'],
    source: '现行有效',
  },
  {
    title: '中华人民共和国治安管理处罚法',
    article: '第49条',
    content: '盗窃、诈骗、哄抢、抢夺、敲诈勒索或者故意损毁公私财物的，处五日以上十日以下拘留，可以并处五百元以下罚款；情节较重的，处十日以上十五日以下拘留，可以并处一千元以下罚款。',
    keywords: ['治安管理', '诈骗', '拘留', '罚款', '行政处罚'],
    source: '现行有效',
  },
  {
    title: '中华人民共和国反电信网络诈骗法',
    article: '第31条',
    content: '任何单位和个人不得非法制造、买卖、提供或者使用用于实施电信网络诈骗等违法犯罪的设备、程序。不得为他人实施电信网络诈骗活动提供相关技术支持或者帮助。',
    keywords: ['反诈法', '设备', '程序', '技术支持', '帮助', '非法制造', '买卖'],
    source: '2022年12月1日起施行',
  },
  {
    title: '中华人民共和国反电信网络诈骗法',
    article: '第44条',
    content: '违反本法第三十一条第一款规定的，没收违法所得，由公安机关或者有关主管部门处违法所得一倍以上十倍以下罚款，没有违法所得或者违法所得不足五万元的，处五十万元以下罚款；情节严重的，由公安机关处十五日以下拘留。',
    keywords: ['反诈法', '罚款', '拘留', '设备', '程序', '技术支持'],
    source: '2022年12月1日起施行',
  },
  {
    title: '最高人民法院、最高人民检察院关于办理诈骗刑事案件具体应用法律若干问题的解释',
    article: '第1条',
    content: '诈骗公私财物价值三千元至一万元以上、三万元至十万元以上、五十万元以上的，应当分别认定为刑法第二百六十六条规定的"数额较大"、"数额巨大"、"数额特别巨大"。',
    keywords: ['诈骗', '数额标准', '三千', '三万', '五十万', '数额较大', '数额巨大', '数额特别巨大', '司法解释'],
    source: '2011年4月8日起施行',
  },
  {
    title: '最高人民法院、最高人民检察院关于办理诈骗刑事案件具体应用法律若干问题的解释',
    article: '第2条',
    content: '诈骗公私财物达到本解释第一条规定的数额标准，具有下列情形之一的，可以依照刑法第二百六十六条的规定酌情从严惩处：（一）通过发送短信、拨打电话或者利用互联网、广播电视、报刊杂志等发布虚假信息，对不特定多数人实施诈骗的；（二）诈骗救灾、抢险、防汛、优抚、扶贫、移民、救济、医疗款物的；（三）以赈灾募捐名义实施诈骗的；（四）诈骗残疾人、老年人或者丧失劳动能力人的财物的；（五）造成被害人自杀、精神失常或者其他严重后果的。',
    keywords: ['诈骗', '从严惩处', '短信', '电话', '互联网', '救灾', '残疾人', '老年人', '自杀', '司法解释'],
    source: '2011年4月8日起施行',
  },
  {
    title: '中华人民共和国反电信网络诈骗法',
    article: '第46条',
    content: '组织、策划、实施、参与电信网络诈骗活动或者为电信网络诈骗活动提供相关帮助的违法犯罪人员，除依法承担刑事责任或者行政责任外，造成他人损害的，依照《中华人民共和国民法典》等法律的规定承担民事责任。',
    keywords: ['反诈法', '民事责任', '赔偿责任', '损害'],
    source: '2022年12月1日起施行',
  },
  {
    title: '中华人民共和国个人信息保护法',
    article: '第10条',
    content: '任何组织、个人不得非法收集、使用、加工、传输他人个人信息，不得非法买卖、提供或者公开他人个人信息；不得从事危害国家安全、公共利益的个人信息处理活动。',
    keywords: ['个人信息保护', '非法收集', '非法买卖', '信息泄露', '隐私'],
    source: '2021年11月1日起施行',
  },
  {
    title: '中华人民共和国网络安全法',
    article: '第44条',
    content: '任何个人和组织不得窃取或者以其他非法方式获取个人信息，不得非法出售或者非法向他人提供个人信息。',
    keywords: ['网络安全', '个人信息', '窃取', '非法出售', '信息泄露'],
    source: '2017年6月1日起施行',
  },
  {
    title: '中华人民共和国反电信网络诈骗法',
    article: '第11条',
    content: '电信业务经营者应当依法全面落实电话用户真实身份信息登记制度。办理电话卡不得超出国家有关规定限制的数量。对识别异常的电话卡用户可以重新核验身份信息。银行业金融机构、非银行支付机构应当建立开立企业账户异常情形的风险防控机制。',
    keywords: ['反诈法', '实名制', '电话卡', '银行账户', '支付账户', '风险防控'],
    source: '2022年12月1日起施行',
  },
]

export function execSearchLaw(args = {}) {
  const query = String(args.query || '').trim()
  const limit = Math.max(1, Math.min(Number(args.limit) || 5, 15))

  if (!query) {
    return toolJson({
      error: '请提供检索关键词 (query 参数)',
      total_laws: LAW_DATABASE.length,
      hint: '可搜索：诈骗罪、反诈法、量刑、个人信息、网络犯罪等',
    }, false)
  }

  const terms = query.toLowerCase().split(/[\s,，、。.；;]+/).map(t => t.trim()).filter(Boolean)

  const scored = LAW_DATABASE.map(law => {
    const hay = `${law.title} ${law.article} ${law.content} ${law.keywords.join(' ')}`.toLowerCase()
    let score = 0
    for (const term of terms) {
      if (hay.includes(term.toLowerCase())) score++
      // 关键词精确匹配加分
      if (law.keywords.some(k => k.toLowerCase() === term.toLowerCase())) score += 2
    }
    return { law, score }
  })
  .filter(item => item.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, limit)

  if (scored.length === 0) {
    return toolJson({
      query,
      count: 0,
      results: [],
      total_laws: LAW_DATABASE.length,
      hint: '未找到匹配的法规条文。尝试搜索：诈骗罪、反诈法、量刑标准、个人信息保护',
    })
  }

  return toolJson({
    query,
    count: scored.length,
    total_laws: LAW_DATABASE.length,
    results: scored.map(item => ({
      title: item.law.title,
      article: item.law.article,
      content: item.law.content,
      keywords: item.law.keywords,
      source: item.law.source,
      match_score: item.score,
    })),
    hint: '以上为内置法规库匹配结果。如需更详细的法规条文，建议通过 web_search 搜索"中华人民共和国反电信网络诈骗法 全文"。',
  })
}

// ─── 3. check_qrcode: 二维码内容分析 ──────────────────────────────────────────

function analyzeUrl(url) {
  const indicators = []
  let safetyScore = 100

  try {
    const parsed = new URL(url)
    const domain = parsed.hostname

    // HTTP (非 HTTPS)
    if (parsed.protocol === 'http:') {
      indicators.push({ type: 'insecure_protocol', severity: 'high', detail: '使用 HTTP 明文传输，数据可被截获' })
      safetyScore -= 30
    }

    // IP 地址作为域名
    if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(domain)) {
      indicators.push({ type: 'ip_address', severity: 'high', detail: '使用 IP 地址而非域名，常见于钓鱼网站' })
      safetyScore -= 25
    }

    // 端口号
    if (parsed.port && !['80', '443'].includes(parsed.port)) {
      indicators.push({ type: 'unusual_port', severity: 'medium', detail: `使用非标准端口 ${parsed.port}` })
      safetyScore -= 15
    }

    // 超长域名
    if (domain.length > 30) {
      indicators.push({ type: 'long_domain', severity: 'medium', detail: `域名过长 (${domain.length} 字符)，可能为仿冒` })
      safetyScore -= 10
    }

    // 可疑 TLD
    const suspiciousTlds = ['.xyz', '.top', '.tk', '.ml', '.ga', '.cf', '.gq', '.click', '.link', '.work', '.review']
    if (suspiciousTlds.some(tld => domain.endsWith(tld))) {
      indicators.push({ type: 'suspicious_tld', severity: 'medium', detail: `使用可疑顶级域名，常见于钓鱼网站` })
      safetyScore -= 20
    }

    // 仿冒域名检测
    const legitDomains = ['taobao.com', 'tmall.com', 'jd.com', 'alipay.com', 'weixin.qq.com', 'bank-of-china.com', 'icbc.com.cn']
    for (const legit of legitDomains) {
      const legitPart = legit.split('.')[0]
      if (domain.includes(legitPart) && !domain.endsWith(legit)) {
        indicators.push({ type: 'lookalike_domain', severity: 'high', detail: `域名含"${legitPart}"但非官方域名，疑似仿冒` })
        safetyScore -= 35
        break
      }
    }

    // 查询参数中的可疑模式
    if (parsed.search) {
      if (/login|passwd|password|account|verify|bank|card|pin|code/i.test(parsed.search)) {
        indicators.push({ type: 'sensitive_params', severity: 'high', detail: 'URL 参数中包含敏感关键词，可能为钓鱼页面' })
        safetyScore -= 20
      }
    }

    // 路径中的可疑模式
    if (/login|verify|auth|update|secure|confirm|activate|unlock/i.test(parsed.pathname)) {
      indicators.push({ type: 'action_path', severity: 'low', detail: '路径包含操作类关键词，需确认是否为正规页面' })
      safetyScore -= 5
    }

    return { domain, protocol: parsed.protocol, parsed, indicators, safetyScore: Math.max(0, safetyScore) }
  } catch {
    return { domain: null, protocol: null, parsed: null, indicators: [{ type: 'invalid_url', severity: 'medium', detail: '无法解析为有效 URL' }], safetyScore: 50 }
  }
}

export function execCheckQrcode(args = {}) {
  const content = String(args.content || '').trim()

  if (!content) {
    return toolJson({
      error: '请提供二维码内容 (content 参数)',
      hint: '传入二维码扫描后得到的内容字符串（URL、文本、名片等）',
    }, false)
  }

  const isUrl = /^https?:\/\//i.test(content)
  const indicators = []
  let safetyScore = 100
  let contentType = 'text'
  let domain = null

  if (isUrl) {
    contentType = 'url'
    const analysis = analyzeUrl(content)
    domain = analysis.domain
    indicators.push(...analysis.indicators)
    safetyScore = analysis.safetyScore
  } else {
    // 非URL内容分析
    if (/^\d{11}$/.test(content.replace(/\s/g, ''))) {
      contentType = 'phone'
      indicators.push({ type: 'phone_number', severity: 'low', detail: '二维码内容为电话号码，需确认是否为已知诈骗号码' })
      safetyScore -= 10
    } else if (/^[A-Za-z0-9+/=]+$/.test(content) && content.length > 50) {
      contentType = 'encoded_data'
      indicators.push({ type: 'encoded', severity: 'medium', detail: '内容为编码数据，可能包含隐藏信息' })
      safetyScore -= 15
    } else if (/支付|转账|付款|收款|wallet|pay/i.test(content)) {
      contentType = 'payment'
      indicators.push({ type: 'payment_related', severity: 'high', detail: '内容包含支付相关关键词，需确认收款方身份' })
      safetyScore -= 30
    } else if (/wifi|password|密码|WIFI/i.test(content)) {
      contentType = 'wifi_config'
      indicators.push({ type: 'wifi_config', severity: 'low', detail: '二维码为 WiFi 配置，连接陌生 WiFi 有风险' })
      safetyScore -= 5
    }
  }

  // 钓鱼关键词检测
  const phishingKeywords = ['login', 'verify', 'bank', 'secure', 'update', 'confirm', 'activate', 'account', 'password', '验证', '登录', '银行', '安全', '更新', '确认', '激活', '账户', '密码']
  const lowerContent = content.toLowerCase()
  for (const kw of phishingKeywords) {
    if (lowerContent.includes(kw.toLowerCase())) {
      indicators.push({ type: 'phishing_keyword', severity: 'medium', detail: `内容包含敏感关键词 "${kw}"` })
      safetyScore -= 8
      break
    }
  }

  safetyScore = Math.max(0, safetyScore)
  const isPhishing = safetyScore < 50
  const recommendation = safetyScore >= 70
    ? '二维码内容未发现明显风险，但仍建议确认来源后再操作。'
    : safetyScore >= 40
      ? '二维码内容存在一定风险，请谨慎操作。不要输入个人信息或进行转账。'
      : '二维码内容高风险，疑似钓鱼/诈骗。请勿点击链接、输入信息或进行任何操作。建议拨打 96110 核实。'

  return toolJson({
    content_type: contentType,
    content_preview: content.slice(0, 200),
    domain,
    is_url: isUrl,
    is_phishing: isPhishing,
    safety_score: safetyScore,
    risk_indicators: indicators,
    recommendation,
    hotline: '96110',
  })
}

// ─── 4. verify_identity: 综合身份核实 ─────────────────────────────────────────

function analyzePhone(phone) {
  const indicators = []
  let riskScore = 0

  const cleaned = phone.replace(/[\s\-()]/g, '')

  // 国际号码
  if (/^\+?\d{7,15}$/.test(cleaned)) {
    if (cleaned.startsWith('+') && !cleaned.startsWith('+86')) {
      indicators.push({ type: 'international_number', severity: 'high', detail: '国际电话号码，境外诈骗高发' })
      riskScore += 30
    } else if (/^1[3-9]\d{9}$/.test(cleaned.replace(/^\+?86/, ''))) {
      // 中国手机号
      const domesticPhone = cleaned.replace(/^\+?86/, '')
      // 虚拟号段
      if (/^170|^171|^165|^167/.test(domesticPhone)) {
        indicators.push({ type: 'virtual_number', severity: 'medium', detail: '虚拟运营商号段，诈骗使用率较高' })
        riskScore += 15
      }
    } else if (!cleaned.startsWith('+86') && cleaned.length < 11) {
      indicators.push({ type: 'short_number', severity: 'low', detail: '短号码，可能是服务号或特服号' })
    }
  } else {
    indicators.push({ type: 'invalid_phone', severity: 'low', detail: '号码格式不标准' })
  }

  return { indicators, riskScore }
}

export function execVerifyIdentity(args = {}) {
  const phone = String(args.phone || '').trim()
  const url = String(args.url || '').trim()
  const text = String(args.text || '').trim()
  const name = String(args.name || '').trim()

  const findings = []
  let totalRiskScore = 0

  // 1. 文本规则引擎分析
  if (text) {
    const ruleResult = runFraudRuleEngine(text)
    if (ruleResult.hits && ruleResult.hits.length > 0) {
      findings.push({
        source: 'rule_engine',
        matched: true,
        risk_level: ruleResult.level,
        score: ruleResult.score,
        fraud_types: ruleResult.hits.map(h => h.type),
        signals: [...new Set(ruleResult.hits.flatMap(h => h.signals || []))],
      })
      totalRiskScore = Math.max(totalRiskScore, ruleResult.score)
    } else {
      findings.push({
        source: 'rule_engine',
        matched: false,
        risk_level: 'low',
        score: 0,
        note: '未命中已知诈骗话术规则',
      })
    }
  }

  // 2. URL 分析
  if (url) {
    const urlAnalysis = analyzeUrl(url)
    if (urlAnalysis.indicators.length > 0) {
      findings.push({
        source: 'url_analysis',
        domain: urlAnalysis.domain,
        risk_indicators: urlAnalysis.indicators,
        safety_score: urlAnalysis.safetyScore,
      })
      // URL 安全分转换为风险分 (safety_score 越高风险越低)
      const urlRiskScore = 100 - urlAnalysis.safetyScore
      totalRiskScore = Math.max(totalRiskScore, urlRiskScore)
    } else {
      findings.push({
        source: 'url_analysis',
        domain: urlAnalysis.domain,
        risk_indicators: [],
        safety_score: urlAnalysis.safetyScore,
        note: 'URL 未发现明显风险特征',
      })
    }
  }

  // 3. 电话号码分析
  if (phone) {
    const phoneAnalysis = analyzePhone(phone)
    findings.push({
      source: 'phone_analysis',
      phone,
      indicators: phoneAnalysis.indicators,
      risk_score: phoneAnalysis.riskScore,
    })
    totalRiskScore += phoneAnalysis.riskScore * 0.3 // 电话号码单独权重较低
  }

  // 4. 综合评级
  totalRiskScore = Math.min(100, Math.round(totalRiskScore))
  let riskLevel, recommendation

  if (totalRiskScore >= 70) {
    riskLevel = 'critical'
    recommendation = '高风险：强烈建议停止一切交互，不要转账或提供个人信息。立即拨打 96110 报警。'
  } else if (totalRiskScore >= 40) {
    riskLevel = 'high'
    recommendation = '较高风险：请谨慎对待。不要轻易转账或提供敏感信息。建议通过官方渠道核实对方身份。'
  } else if (totalRiskScore >= 20) {
    riskLevel = 'medium'
    recommendation = '中等风险：存在部分可疑特征。建议进一步核实后再决定是否信任。'
  } else {
    riskLevel = 'low'
    recommendation = '低风险：未发现明显诈骗特征。但仍建议保持警惕，特别是涉及转账时。'
  }

  return toolJson({
    inputs: { phone: phone || undefined, url: url || undefined, text: text || undefined, name: name || undefined },
    risk_level: riskLevel,
    risk_score: totalRiskScore,
    findings,
    recommendation,
    rule_engine_version: FRAUD_RULE_ENGINE_VERSION,
    hotline: '96110',
    hint: '综合核实结果基于本地规则引擎和模式分析，仅供参考。如需更深入的风险研判，建议结合 RAG 案例库。',
  })
}
