// 反诈规则引擎（Fraud Rule Engine）
//
// 这是 AGENTS.md 中承诺的「反诈核心工具」真正的实现 —— 专门做**诈骗话术专用规则匹配**，
// 与 context/rule-engine.js（给 LLM 注入运行时上下文：服务器/VPN 话题）是两条完全不同的线。
//
// 输入：用户提交的对话 / 聊天记录 / 转账邀请 / 链接文案等任意文本
// 输出：命中的诈骗类型 + 风险分（0-100）+ 风险等级 + 话术证据 + 套路拆解 + 处置建议
//
// 设计为纯函数、零外部依赖，可被：
//   - LLM 工具 fraud_rule_screen（研判链中主动调用）
//   - 研判预分析层直接同步调用
//   - 单元测试脚本调用
//
// 与 PostgreSQL + pgvector 的 RAG 案例库互补：规则引擎做「已知话术模式」的确定性快速筛查，
// RAG 做「语义相似历史案例」的检索，二者结果在研判报告中分别呈现。

/**
 * @typedef {Object} FraudRule
 * @property {string} id        英文标识
 * @property {string} type      中文诈骗类型名
 * @property {'high'|'medium'|'low'} risk  该类型本身的危险等级
 * @property {number} weight    命中时的基础风险权重（0-100）
 * @property {RegExp[]} patterns 话术特征正则
 * @property {string[]} keywords 关键词（命中即累加）
 * @property {string[]} signals  行为信号（如「要求下载非官方 APP」）
 * @property {string[]} playbook 套路分步拆解（可视化用）
 * @property {string[]} advice   处置建议
 *
 * @typedef {Object} FraudHit
 * @property {string} id
 * @property {string} type
 * @property {string} risk
 * @property {number} weight
 * @property {number} score      本类型得分（0-100）
 * @property {string[]} matchedPatterns
 * @property {string[]} matchedKeywords
 * @property {string[]} signals
 * @property {string[]} playbook
 * @property {string[]} advice
 *
 * @typedef {Object} FraudRuleResult
 * @property {number} score
 * @property {string} level
 * @property {FraudHit[]} hits
 * @property {string} summary
 */

// 反诈话术规则库（覆盖国内主要诈骗类型，按官方反诈中心分类整理）
const FRAUD_RULES = [
  {
    id: 'brushing',
    type: '刷单返利',
    risk: 'high',
    weight: 85,
    patterns: [
      /刷[单点]返?利/,
      /垫付(资金|本金)/,
      /联[单任务]/,
      /激活返?款/,
      /佣金\s*\d+%?/,
      /(完成|做)\s*任务.*返(现|款|佣金)/,
    ],
    keywords: ['刷单', '返利', '佣金', '任务单', '联单', '返款', '兼职', '点赞返现'],
    signals: ['要求先垫付再返款', '承诺高额佣金零门槛', '引导下载非官方 APP'],
    playbook: [
      '1. 抛出「零门槛兼职 / 刷单返利」诱饵',
      '2. 小额返利骗取信任（前几单真的返钱）',
      '3. 以「联单 / 激活 / 任务未完成」为由要求连续垫付大额',
      '4. 垫付后失联，本金佣金全无',
    ],
    advice: ['刷单兼职本身违法', '任何要求先垫付的「兼职」都是诈骗', '立即拉黑并拨打 96110'],
  },
  {
    id: 'refund_customer_service',
    type: '冒充电商物流客服',
    risk: 'high',
    weight: 88,
    patterns: [
      /(订单|快递|包裹).*(退款|理赔|丢失|破损)/,
      /误开(了)?(会员|代理商|VIP)/,
      /(客服|理赔).*(加|加微信|QQ|钉钉)/,
      /(退|赔)\s*款\s*\d+/,
      /(理赔|退款).*(链接|二维码|APP)/,
    ],
    keywords: ['退款理赔', '快递丢失', '包裹破损', '误开会员', '电商客服', '物流客服', '双倍理赔'],
    signals: ['主动联系称订单异常', '要求脱离平台私下沟通', '发来退款链接 / 二维码'],
    playbook: [
      '1. 主动来电称「订单异常 / 快递丢失」要理赔',
      '2. 谎称「误开通会员 / 代理商」每月扣费，需取消',
      '3. 引导点链接 / 下载 APP 操作「退款认证」',
      '4. 以「验证资金 / 刷流水」为由诱导转账',
    ],
    advice: ['退货退款在原平台内完成，绝不脱离平台', '不点陌生退款链接', '拨打官方 App 内客服核实'],
  },
  {
    id: 'impersonate_police',
    type: '冒充公检法',
    risk: 'high',
    weight: 95,
    patterns: [
      /(涉嫌|卷入).*(洗钱|诈骗|犯罪)/,
      /(安全账户|资金审查|资金清查)/,
      /(通缉令|逮捕令|传票|协查)/,
      /(公安|检察|法院).*(加|QQ|微信|视频)/,
      /(不要|不许).*(挂断?|告诉|报警)/,
    ],
    keywords: ['安全账户', '资金审查', '通缉令', '逮捕令', '涉嫌洗钱', '协查', '保密协议', '公安刚联系'],
    signals: ['要求屏幕共享 / 开视频做笔录', '要求把资金转到「安全账户」', '恐吓「不许告诉家人」'],
    playbook: [
      '1. 自称公检法称你涉嫌某案，发送假通缉令',
      '2. 要求「配合资金审查」转入所谓安全账户',
      '3. 要求屏幕共享 / 视频笔录，窃取验证码',
      '4. 恐吓不得挂断、不得告知家人',
    ],
    advice: ['公检法绝不会要求转账到「安全账户」', '不共享屏幕、不透露验证码', '挂断后拨打 110 核实'],
  },
  {
    id: 'fake_investment',
    type: '虚假投资理财',
    risk: 'high',
    weight: 90,
    patterns: [
      /(内幕|稳赚|保本|高收益).*(股票|期货|虚拟币|外汇)/,
      /(导师|老师|专家).*(带单|建仓|操盘)/,
      /(虚假|私建).*(平台|交易所|APP)/,
      /(充值|入金).*(USDT|虚拟币|钱包)/,
    ],
    keywords: ['内幕消息', '稳赚不赔', '带单', '建仓', '虚拟币', '入金', '投资导师', '荐股群'],
    signals: ['拉入荐股 / 投资群让「导师」带单', '引导到非官方投资平台充值', '前期可小额提现诱骗加大投入'],
    playbook: [
      '1. 以「投资导师 / 内幕消息」引流进群',
      '2. 晒虚假盈利截图营造赚钱假象',
      '3. 引导到自建虚假平台充值（前期可提现）',
      '4. 加大投入后平台关闭 / 无法提现',
    ],
    advice: ['不存在稳赚不赔的投资', '不向陌生平台充值', '通过正规券商开户交易'],
  },
  {
    id: 'pig_butchering',
    type: '杀猪盘 / 婚恋交友',
    risk: 'high',
    weight: 92,
    patterns: [
      /(网恋|交友|缘分).*(带你|一起|赚钱)/,
      /(感情|信任).*(投资|理财|博彩)/,
      /(私聊|私密).*(平台|APP|下注)/,
    ],
    keywords: ['网恋', '杀猪盘', '带你赚钱', '感情信任', '博彩', '私密平台', '婚恋交友'],
    signals: ['交友后不久引导「一起投资 / 博彩」', '推荐所谓「内部平台」', '情感诱导加大投入'],
    playbook: [
      '1. 婚恋 / 社交平台建立「感情」',
      '2. 以「一起赚钱」为由推荐投资 / 博彩平台',
      '3. 前期小额盈利诱骗大额投入',
      '4. 提现时以「税费 / 保证金」诈骗后消失',
    ],
    advice: ['网恋对象荐投资极可能是杀猪盘', '不向陌生平台充值', '与亲友核实后再决定'],
  },
  {
    id: 'impersonate_boss',
    type: '冒充领导熟人',
    risk: 'high',
    weight: 90,
    patterns: [
      /(领导|老板|老同学|总).*(急用钱|周转|转账|垫付|走个账)/,
      /(新号|换了微信|这是小号).*(转账|代付|急用钱)/,
      /(帮我|麻烦你).*(转账|代付|走个账)/,
    ],
    keywords: ['领导急用钱', '新号加你', '帮忙转账', '代付', '走账', '不方便用自己账号', '急用钱', '新号'],
    signals: ['用新号冒充领导 / 熟人', '以「不方便」要求代付 / 转账', '催促且不让核实'],
    playbook: [
      '1. 冒充领导 / 熟人以新号添加好友',
      '2. 寒暄后称「急用钱 / 走账」需帮忙',
      '3. 发送伪造转账截图（称延时到账）',
      '4. 催促你先行垫付真实转账',
    ],
    advice: ['凡「新号领导借钱」先电话 / 当面核实', '不凭截图转账', '走单位正式财务流程'],
  },
  {
    id: 'credit_fraud',
    type: '虚假征信 / 注销网贷',
    risk: 'high',
    weight: 88,
    patterns: [
      /(注销|清零|消除).*(校园贷|网贷|白条|花呗)/,
      /(影响|不良).*(征信|记录)/,
      /(利率|额度).*(调整|清空|对冲)/,
      /(京东|支付宝).*(白条|借呗).*(注销|关闭)/,
    ],
    keywords: ['注销网贷', '消除征信', '校园贷记录', '白条注销', '影响征信', '清空额度'],
    signals: ['称「不注销会影响征信」', '要求「清空额度 / 对冲资金」', '引导下载会议 APP 共享屏幕'],
    playbook: [
      '1. 自称平台客服称「网贷 / 白条需注销否则影响征信」',
      '2. 要求「清空额度」转入所谓对冲账户',
      '3. 屏幕共享窃取验证码完成贷款 / 转账',
      '4. 消失',
    ],
    advice: ['个人征信无法人为「注销 / 清零」', '不共享屏幕', '通过官方 App 查询征信'],
  },
  {
    id: 'loan_scam',
    type: '虚假贷款',
    risk: 'high',
    weight: 82,
    patterns: [
      /(低息|无抵押|秒到).*(贷款|放款)/,
      /(手续费|解冻费|保证金|刷流水).*(贷款|放款)/,
      /(银行卡|流水).*(异常|冻结).*(充值|转账)/,
    ],
    keywords: ['低息贷款', '无抵押', '秒到账', '解冻费', '保证金', '刷流水', '贷款工本费'],
    signals: ['放款前先收手续费 / 保证金', '称「银行卡冻结需转账解冻」', '引导下载非官方贷款 APP'],
    playbook: [
      '1. 以「低息无抵押秒到」吸引贷款人',
      '2. 放款前以「手续费 / 解冻费 / 保证金」要求先转账',
      '3. 谎称「银行卡异常需刷流水」继续骗钱',
      '4. 钱到手后消失',
    ],
    advice: ['正规贷款放款前不收费', '不向「解冻账户」转账', '通过持牌金融机构办理'],
  },
  {
    id: 'medical_insurance',
    type: '冒充医保社保',
    risk: 'high',
    weight: 86,
    patterns: [
      /(医保|社保|社保局).*(异常|停用|封停)/,
      /(账户|卡).*(被盗刷|异常消费)/,
      /(人工|客服).*(核对|认证).*(信息|资金)/,
    ],
    keywords: ['医保停用', '社保异常', '社保卡被盗刷', '医保局客服', '账户封存'],
    signals: ['自称医保 / 社保局称账户异常', '要求认证 / 转账「保全账户」', '发来核查链接'],
    playbook: [
      '1. 自称医保 / 社保局称「账户异常 / 停用」',
      '2. 恐吓「将被停用 / 涉嫌骗保」',
      '3. 引导点链接「认证」并转账「保全」',
      '4. 窃取资金',
    ],
    advice: ['医保社保业务到官方渠道办理', '不点陌生核查链接', '拨打 12393 社保热线核实'],
  },
  {
    id: 'nude_extortion',
    type: '裸聊敲诈',
    risk: 'high',
    weight: 90,
    patterns: [
      /(裸聊|视频|私密).*(约吗|玩吗)/,
      /(通讯录|家人朋友).*(群发|曝光|发送)/,
      /(转账|封口).*(删视频|不曝光)/,
    ],
    keywords: ['裸聊', '约炮', '通讯录曝光', '删除视频', '封口费', '不转账就群发'],
    signals: ['诱导下载含木马的「直播」APP', '窃取通讯录后勒索', '以「不曝光」要挟转账'],
    playbook: [
      '1. 社交平台诱导裸聊并诱导下载恶意 APP',
      '2. 后台窃取手机通讯录',
      '3. 以「群发不雅视频」要挟转账封口',
      '4. 反复勒索',
    ],
    advice: ['不下载陌生直播 APP', '不裸聊', '被勒索立即报警并保留证据'],
  },
  {
    id: 'game_trade',
    type: '网络游戏虚假交易',
    risk: 'medium',
    weight: 65,
    patterns: [
      /(游戏账号|装备|皮肤).*(低价|收购|出售)/,
      /(解冻|手续费|保证金).*(游戏|账号)/,
      /(非官方|私下).*(交易|充值)/,
    ],
    keywords: ['游戏账号交易', '装备收购', '低价充值', '账号解冻费', '私下交易'],
    signals: ['脱离官方交易平台私下交易', '要求先付「解冻 / 手续费」', '发来虚假交易网站'],
    playbook: [
      '1. 发布低价收购 / 出售游戏账号装备信息',
      '2. 引导到虚假交易平台或私下交易',
      '3. 以「解冻 / 手续费」要求先转账',
      '4. 拉黑消失',
    ],
    advice: ['游戏交易走官方平台', '不私下转账', '警惕远低于市价的交易'],
  },
  {
    id: 'prize_scam',
    type: '中奖 / 免费送',
    risk: 'medium',
    weight: 60,
    patterns: [
      /(免费领|中奖|幸运用户).*(奖品|红包|手机)/,
      /(缴税|手续费|邮费).*(领取|中奖)/,
      /(点击|扫码).*(领取|中奖)/,
    ],
    keywords: ['免费送', '中奖了', '幸运用户', '领红包', '缴税领奖', '手续费领奖'],
    signals: ['称中奖但需先缴税 / 手续费', '要求点击 / 扫码领奖', '引导填写个人信息'],
    playbook: [
      '1. 通知「中奖 / 免费送」制造惊喜',
      '2. 以「缴税 / 手续费 / 邮费」要求先付款',
      '3. 索要银行卡 / 验证码',
      '4. 骗钱或盗刷',
    ],
    advice: ['正规中奖不要求先付款', '不扫陌生领奖码', '天上不会掉馅饼'],
  },
  {
    id: 'fake_shopping',
    type: '虚假购物',
    risk: 'medium',
    weight: 62,
    patterns: [
      /(低价|秒杀|清仓).*(手机|数码|名牌)/,
      /(私下|微信).*(付款|定金)/,
      /(定金|订金).*(不退|预付)/,
    ],
    keywords: ['低价购物', '秒杀', '私下付款', '付定金', '先款后货'],
    signals: ['远低于市场价引流', '要求私下微信 / 支付宝付款', '付款后不发货'],
    playbook: [
      '1. 以远低于市价商品引流',
      '2. 要求脱离平台私下付款',
      '3. 收款后不发货或发假货',
      '4. 拉黑',
    ],
    advice: ['购物走正规电商平台', '不私下转账', '选择担保交易'],
  },
  {
    id: 'class_fee',
    type: '冒充老师 / 班级群收费',
    risk: 'medium',
    weight: 68,
    patterns: [
      /(家长|同学).*(交费|资料费|班费)/,
      /(老师|班主任).*(群收款|扫码)/,
      /(紧急|马上).*(缴费|接龙)/,
    ],
    keywords: ['班级群收费', '资料费', '班费', '老师让交费', '家长群接龙'],
    signals: ['冒充老师在班级群发收款', '催促尽快缴费', '收款码为个人而非学校对公'],
    playbook: [
      '1. 混入 / 冒充班级群老师',
      '2. 发布「资料费 / 班费」收款通知',
      '3. 催促家长接龙缴费',
      '4. 收款后退出群',
    ],
    advice: ['缴费前在群内 / 电话核实老师身份', '核对收款方是否为学校对公账户', '不向个人码付学费'],
  },
  {
    id: 'elderly_health',
    type: '养老 / 保健品诈骗',
    risk: 'medium',
    weight: 64,
    patterns: [
      /(免费体检|健康讲座|专家义诊).*(保健品|理疗)/,
      /(包治百病|特效|根治).*(药|仪器)/,
      /(养老项目|高额返利).*(投资|会员)/,
    ],
    keywords: ['免费体检', '健康讲座', '包治百病', '养老投资', '特效保健品', '理疗仪'],
    signals: ['以免费体检 / 讲座套取老人信息', '夸大疗效推销高价保健品', '以「养老项目」承诺高额返利'],
    playbook: [
      '1. 用免费体检 / 讲座建立信任',
      '2. 夸大病情推销高价「特效」保健品 / 仪器',
      '3. 以「养老投资」承诺返利吸收资金',
      '4. 卷款',
    ],
    advice: ['保健品不能治病', '身体不适去正规医院', '大额养老投资与子女商量'],
  },
  {
    id: 'bank_card',
    type: '冒充银行 / 信用卡',
    risk: 'high',
    weight: 84,
    patterns: [
      /(银行卡|信用卡).*(冻结|异常|盗刷)/,
      /(额度|提额).*(点击|链接|APP)/,
      /(积分|权益).*(兑换|清零).*(链接)/,
    ],
    keywords: ['银行卡冻结', '信用卡提额', '积分兑换', '账户异常', '银行客服'],
    signals: ['自称银行称卡异常 / 可提额', '发来「核实」链接 / APP', '索要验证码 / 密码'],
    playbook: [
      '1. 自称银行称「卡异常 / 可提额」',
      '2. 发链接 / APP「核实身份」',
      '3. 套取卡号、密码、验证码',
      '4. 盗刷',
    ],
    advice: ['银行不会索要短信验证码', '不点陌生链接', '拨打卡面官方电话核实'],
  },
]

// 正则安全测试：捕获非法正则避免整体崩溃
function safeMatch(re, text) {
  try {
    return re.test(text)
  } catch {
    return false
  }
}

/**
 * 风险分 → 风险等级（与 prompt.js 研判分档一致）
 * @param {number} score
 * @returns {'无风险'|'低风险'|'中风险'|'高风险'|'严重诈骗'}
 */
function levelFromScore(score) {
  if (score >= 90) return '严重诈骗'
  if (score >= 70) return '高风险'
  if (score >= 50) return '中风险'
  if (score >= 30) return '低风险'
  return '无风险'
}

/**
 * 运行反诈规则引擎：对输入文本做诈骗话术专用规则匹配。
 * @param {string} input
 * @returns {FraudRuleResult}
 */
export function runFraudRuleEngine(input = '') {
  const text = String(input || '').trim()
  if (!text) {
    return { score: 0, level: '无风险', hits: [], summary: '输入为空，未进行分析。' }
  }

  /** @type {FraudHit[]} */
  const hits = []

  for (const rule of FRAUD_RULES) {
    /** @type {string[]} */
    const matchedPatterns = []
    /** @type {string[]} */
    const matchedKeywords = []

    for (const p of rule.patterns || []) {
      if (safeMatch(p, text)) matchedPatterns.push(p.source || String(p))
    }
    for (const kw of rule.keywords || []) {
      // 中文关键词：直接字面包含即可（大小写不敏感）
      if (text.toLowerCase().includes(kw.toLowerCase())) matchedKeywords.push(kw)
    }

    const total = matchedPatterns.length + matchedKeywords.length
    // 命中门槛：至少 1 条话术正则，或至少 2 个关键词。
    // 单关键词（如「兼职」「中奖了」「新号」）过于常见，不足以判定诈骗，避免误报。
    const qualifies = matchedPatterns.length >= 1 || matchedKeywords.length >= 2
    if (total === 0 || !qualifies) continue

    // 命中越多，本类型得分略增（封顶 100）
    const score = Math.min(100, rule.weight + (total - 1) * 4)
    hits.push({
      id: rule.id,
      type: rule.type,
      risk: rule.risk,
      weight: rule.weight,
      score,
      matchedPatterns,
      matchedKeywords,
      signals: rule.signals || [],
      playbook: rule.playbook || [],
      advice: rule.advice || [],
    })
  }

  if (!hits.length) {
    return { score: 0, level: '无风险', hits: [], summary: '未发现已知诈骗话术特征，但仍建议结合链接检测与 RAG 案例综合研判。' }
  }

  // 总分：以最高得分为基底，叠加其它命中类型贡献（封顶 100）
  const sorted = hits.sort((a, b) => b.score - a.score)
  let score = sorted[0].score
  for (let i = 1; i < sorted.length; i++) {
    score = Math.min(100, score + Math.round(sorted[i].score * 0.18))
  }

  const level = levelFromScore(score)
  const top = sorted[0]
  const summary = `规则引擎命中 ${sorted.length} 类诈骗话术特征，最高危类型「${top.type}」(风险分 ${top.score})。建议结合 RAG 相似案例与链接安全检测综合研判。`

  return { score, level, hits: sorted, summary }
}

/**
 * 返回规则库概览（供 LLM 自查 / 配置面板展示）。
 * @returns {{id:string,type:string,risk:string,weight:number,sampleKeywords:string[]}[]}
 */
export function getFraudRuleCatalog() {
  return FRAUD_RULES.map((r) => ({
    id: r.id,
    type: r.type,
    risk: r.risk,
    weight: r.weight,
    sampleKeywords: (r.keywords || []).slice(0, 6),
  }))
}

/**
 * 当前规则库覆盖的诈骗类型数量（用于自检 / 日志）。
 * @returns {number}
 */
export function countFraudRules() {
  return FRAUD_RULES.length
}

export const FRAUD_RULE_ENGINE_VERSION = '1.0.0'
