// 每日反诈提醒工具：get_daily_tip
//
// 供 LLM 在对话中主动调用，返回当日反诈小知识或演练题。
//
// 数据源优先级：
//   1. 用户自定义 tips (data/user-tips.json)
//   2. 实时诈骗情报 (从 getFraudIntelCache 动态生成)
//   3. 种子 tips 池 (30 条内置反诈知识点)
//
// 按日期确定性选择：同一天返回同一条 tip (hash(date) % tips.length)

import fs from 'fs'
import path from 'path'
import { paths } from '../../paths.js'

function toolJson(obj, ok = true) {
  return JSON.stringify({ ok, ...obj }, null, 2)
}

// 直接读取 fraud-intel 缓存文件，避免导入 fraud-intel.js 的依赖链（better-sqlite3 等）
function getFraudIntelCacheSafe() {
  try {
    const file = path.join(paths.dataDir, 'fraud-intel.json')
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'))
    }
  } catch {}
  return null
}

// ─── 种子 tips 池（30 条，覆盖 8 大诈骗类型）──────────────────────────────────

const SEED_TIPS = [
  {
    title: '刷单返利是最高发的诈骗类型',
    category: 'brushing',
    content: '任何要求先垫付资金再返利的「兼职」都是诈骗。刷单本身违法，不要被前几单的小额返利迷惑。',
    actionable_advice: '看到「刷单」「返利」「佣金」等字眼，立即拉黑对方并拨打 96110。',
  },
  {
    title: '冒充客服退款套路拆解',
    category: 'refund_customer',
    content: '骗子冒充电商平台客服，称订单异常要理赔，引导你点链接或下载 APP 操作「退款认证」，最终骗取转账。',
    actionable_advice: '退货退款在原平台内完成，绝不脱离平台私下沟通，不点陌生退款链接。',
  },
  {
    title: '公检法不会电话办案',
    category: 'impersonate_police',
    content: '真正的公检法不会通过电话办案，更不会要求你把钱转入「安全账户」。这是最经典的冒充公检法诈骗话术。',
    actionable_advice: '听到「安全账户」「资金清查」立即挂断，拨打 110 核实。',
  },
  {
    title: '投资理财诈骗的三大信号',
    category: 'fake_investment',
    content: '①承诺保本保收益；②引导下载非官方 APP 或进入「内部群」；③要求转账到个人账户或境外平台。出现任一信号即为诈骗。',
    actionable_advice: '所有投资理财通过正规金融机构进行，不下载不明来源的投资 APP。',
  },
  {
    title: '杀猪盘：从网恋到破产',
    category: 'pig_butchering',
    content: '骗子在社交平台伪装成高富帅/白富美，建立感情后引导你「一起投资」，先让你小赚，再诱导大额投入后消失。',
    actionable_advice: '网恋对象推荐投资平台一律不信，不向任何未见面的人转账。',
  },
  {
    title: '网贷诈骗：先交钱的贷款都是骗局',
    category: 'loan_scam',
    content: '骗子以「低息快速放贷」为诱饵，要求先交「保证金」「解冻费」「手续费」，交钱后根本不会放贷。',
    actionable_advice: '正规贷款不会要求先交费，需要贷款请到银行或持牌金融机构。',
  },
  {
    title: '中奖诈骗：天上不会掉馅饼',
    category: 'prize_scam',
    content: '收到中奖通知要求先交「税费」「公证费」「邮费」才能领奖，这是经典的中奖诈骗套路。',
    actionable_advice: '未参加的抽奖一律不信，任何要求先交费才能领奖的都是诈骗。',
  },
  {
    title: '裸聊敲诈：一次视频毁所有',
    category: 'nude_extortion',
    content: '骗子通过交友软件诱导视频裸聊并录屏，随后以发送给通讯录好友为要挟勒索钱财。给了钱也不会删视频。',
    actionable_advice: '不与陌生人视频裸聊，遇到敲诈立即报警，不要付钱。',
  },
  {
    title: '验证码是你的钱袋子最后一道锁',
    category: 'general',
    content: '验证码是账户资金的最后一道防线。任何索要验证码的人都是骗子，无论是「客服」「警察」还是「朋友」。',
    actionable_advice: '验证码绝不告诉任何人，不截图、不转发、不输入到陌生链接中。',
  },
  {
    title: '96110 是全国反诈专线',
    category: 'general',
    content: '96110 是全国统一的预警劝阻专用号码。接到 96110 来电说明你正在遭受诈骗，务必接听。',
    actionable_advice: '将 96110 存入通讯录，接到此号码来电立即接听。',
  },
  {
    title: '国家反诈中心 APP 是你的手机保镖',
    category: 'general',
    content: '国家反诈中心 APP 可以拦截诈骗电话、检测可疑 APP、预警诈骗短信。安装后开启来电预警功能。',
    actionable_advice: '在手机应用商店搜索「国家反诈中心」下载安装，开启所有预警功能。',
  },
  {
    title: '「安全账户」不存在',
    category: 'general',
    content: '公检法机关没有所谓的「安全账户」。任何要求你把资金转入「安全账户」进行「清查」的都是诈骗。',
    actionable_advice: '听到「安全账户」三个字，立即挂断电话并拨打 110。',
  },
  {
    title: '陌生人发来的链接不要点',
    category: 'general',
    content: '钓鱼链接是诈骗的入口。点击后可能中木马、泄露个人信息、被引导到虚假支付页面。',
    actionable_advice: '不点陌生链接，尤其是短链接和看起来像但域名不同的仿冒链接。',
  },
  {
    title: '快递丢失理赔诈骗',
    category: 'refund_customer',
    content: '骗子冒充快递公司称包裹丢失要理赔，引导你扫二维码或点链接填写银行卡信息，最终盗刷。',
    actionable_advice: '快递问题在购物平台或快递官方 APP 内处理，不扫陌生二维码。',
  },
  {
    title: '冒充熟人借钱要核实',
    category: 'general',
    content: '通过微信/QQ冒充熟人借钱是常见诈骗。骗子盗取账号后群发借钱消息。',
    actionable_advice: '收到借钱消息，打电话或视频核实对方身份，不仅凭文字就转账。',
  },
  {
    title: '刷单诈骗的进化：从点赞到垫付',
    category: 'brushing',
    content: '刷单诈骗已从「点赞返现」进化到「垫付任务」。先让你点赞赚几块钱，再诱导你垫付做任务，最终血本无归。',
    actionable_advice: '任何「先做任务再返利」的模式都是诈骗，不要因为小额返利就放松警惕。',
  },
  {
    title: '虚假征信修复诈骗',
    category: 'general',
    content: '骗子声称可以「修复征信」「消除不良记录」，要求交费并提供个人信息。征信记录不能人为修改。',
    actionable_advice: '征信记录由央行管理，任何声称能修复征信的都是诈骗。',
  },
  {
    title: '屏幕共享等于交出账户控制权',
    category: 'general',
    content: '骗子以「指导操作」为由要求你开启屏幕共享，实时看到你的密码和验证码，然后盗刷你的账户。',
    actionable_advice: '绝不与陌生人开启屏幕共享，任何要求屏幕共享的「客服」都是骗子。',
  },
  {
    title: '游戏账号交易诈骗',
    category: 'general',
    content: '骗子在游戏内或交易平台谎称收购/出售账号，引导脱离平台交易，骗取账号或钱财。',
    actionable_advice: '游戏账号交易在官方平台进行，不扫陌生二维码、不点陌生链接。',
  },
  {
    title: '演唱会门票诈骗高发',
    category: 'general',
    content: '骗子在社交平台谎称有内部票、黄牛票，要求先付定金或全款，收钱后拉黑。正规渠道购票才安全。',
    actionable_advice: '演唱会门票在官方售票平台购买，不信「内部票」「预留票」。',
  },
  {
    title: '冒充领导转账诈骗',
    category: 'impersonate_police',
    content: '骗子冒充公司领导通过微信/QQ要求紧急转账，利用「不方便打电话」「紧急」等话术催促。',
    actionable_advice: '领导要求转账必须当面或电话核实，不仅凭消息就转账。',
  },
  {
    title: '虚假优惠券/红包诈骗',
    category: 'general',
    content: '社交群传播的「优惠券」「红包」链接可能是钓鱼网站，点击后窃取个人信息或植入木马。',
    actionable_advice: '优惠券在官方 APP 领取，不点不明来源的红包/优惠券链接。',
  },
  {
    title: '二手交易诈骗',
    category: 'general',
    content: '骗子在二手平台谎称买家/卖家，引导脱离平台交易，发送虚假支付链接骗取钱财。',
    actionable_advice: '二手交易在平台内完成支付，不扫对方发的二维码、不点对方发的链接。',
  },
  {
    title: '「注销校园贷」诈骗',
    category: 'loan_scam',
    content: '骗子冒充金融平台客服，称你的「校园贷」记录影响征信，要求转账「注销」。校园贷记录不能人为消除。',
    actionable_advice: '不信「注销贷款记录」的说法，征信问题咨询央行或银行官方客服。',
  },
  {
    title: 'AI换脸视频诈骗',
    category: 'general',
    content: '骗子用AI技术换脸冒充亲友视频通话借钱。视频里的脸可能是假的，但声音和表情可以伪造。',
    actionable_advice: '视频借钱也要二次核实，问一个只有真朋友才知道的问题。',
  },
  {
    title: 'ETC诈骗短信',
    category: 'general',
    content: '收到「ETC过期」「ETC认证失效」短信并附带链接，点击后输入银行卡信息被盗刷。',
    actionable_advice: 'ETC业务在银行或 ETC 官方 APP 办理，不点短信中的链接。',
  },
  {
    title: '医保卡诈骗短信',
    category: 'general',
    content: '「医保卡停用」「医保卡更新」等短信附链接，点击后要求输入个人信息和银行卡号，实为钓鱼网站。',
    actionable_advice: '医保业务在社保局官网或 APP 办理，不点短信链接。',
  },
  {
    title: '反诈演练：你能识破这个骗局吗？',
    category: 'drill',
    content: '【场景】你收到一条短信：「您的快递因地址不详被退回，请点击 http://kuaidi-update.xyz 修改地址重新派送。」你会怎么做？\nA. 点击链接修改地址\nB. 在购物APP里查看物流信息\nC. 回复短信询问\nD. 忽略',
    actionable_advice: '正确答案：B。在官方APP查看物流，不点短信中的链接。短域名 .xyz 是常见钓鱼域名。',
  },
  {
    title: '反诈演练：客服来电要你退款',
    category: 'drill',
    content: '【场景】接到电话称你购买的商品有质量问题要双倍赔偿，但需要你下载一个APP并开启屏幕共享来操作退款。你会怎么做？\nA. 按指示下载APP\nB. 挂断电话，在购物平台查看\nC. 要求对方先转账\nD. 开启屏幕共享',
    actionable_advice: '正确答案：B。退款在原平台操作，不下载陌生APP，绝不开启屏幕共享。',
  },
  {
    title: '反诈演练：网恋对象推荐投资',
    category: 'drill',
    content: '【场景】你在交友软件认识一个人，聊了几周后对方推荐你一个投资平台，说稳赚不赔，还给你看了收益截图。你会怎么做？\nA. 跟着投资试试\nB. 先投小钱看看\nC. 不投资并拉黑\nD. 推荐给朋友一起投',
    actionable_advice: '正确答案：C。这是典型杀猪盘，网恋对象推荐投资一律不信。',
  },
]

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

function hashDate(dateStr) {
  let hash = 0
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash + dateStr.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}

function getTodayStr() {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function readUserTips() {
  try {
    const file = path.join(paths.dataDir, 'user-tips.json')
    if (fs.existsSync(file)) {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'))
      if (Array.isArray(data) && data.length > 0) {
        return data.filter(t => t && t.title && t.content)
      }
    }
  } catch {}
  return null
}

function generateTipFromIntel(cache) {
  if (!cache?.categories?.length) return null
  const allCases = []
  for (const cat of cache.categories) {
    for (const item of (cat.cases || [])) {
      allCases.push({ ...item, category: cat.type })
    }
  }
  if (allCases.length === 0) return null

  // 质量检查：确保选中的案例与诈骗相关（排除百度百科字典等垃圾结果）
  const FRAUD_KW = ['诈骗', '骗局', '骗', '警情', '通报', '警方', '反诈', '受害', '套路', '手法', '案例', '预警', '96110']
  const relevantCases = allCases.filter(c => {
    const text = (c.title + ' ' + (c.summary || '')).toLowerCase()
    return FRAUD_KW.some(kw => text.includes(kw))
  })
  if (relevantCases.length === 0) return null  // 缓存全是垃圾，回退到种子 tips

  const idx = hashDate(getTodayStr()) % relevantCases.length
  const c = relevantCases[idx]
  return {
    title: c.title,
    category: 'fraud_intel',
    content: c.summary || c.title,
    actionable_advice: '关注此类新型诈骗手法，遇到类似情况立即拨打 96110。',
    source: `实时情报: ${c.source || '网络采集'}`,
  }
}

// ─── 主函数 ───────────────────────────────────────────────────────────────────

/**
 * 执行每日反诈提醒工具。
 * @param {Object} args
 * @param {string} [args.date]  日期 (YYYY-MM-DD)，默认今天
 * @param {string} [args.category]  限定类型 (brushing/refund_customer/impersonate_police/fake_investment/pig_butchering/loan_scam/prize_scam/nude_extortion/general/drill)
 * @returns {string} JSON 字符串
 */
export function execGetDailyTip(args = {}) {
  const date = String(args.date || getTodayStr()).trim()
  const categoryFilter = String(args.category || '').trim().toLowerCase()

  // 确定候选 tips
  let pool = []
  let sourceType = 'seed'

  // 优先级 1: 用户自定义 tips
  const userTips = readUserTips()
  if (userTips && userTips.length > 0) {
    pool = userTips
    sourceType = 'user'
  }

  // 优先级 2: 实时情报 (仅当无用户tips时)
  if (pool.length === 0) {
    const intelTip = generateTipFromIntel(getFraudIntelCacheSafe())
    if (intelTip) {
      return toolJson({
        tip: intelTip,
        source_type: 'fraud_intel',
        date,
        total_seed_tips: SEED_TIPS.length,
        hint: '今日提醒来自实时诈骗情报。也可调用 get_daily_tip(category="drill") 获取演练题。',
      })
    }
  }

  // 优先级 3: 种子 tips 池
  if (pool.length === 0) {
    pool = SEED_TIPS
    sourceType = 'seed'
  }

  // 按类型筛选
  if (categoryFilter) {
    const filtered = pool.filter(t => String(t.category || '').toLowerCase() === categoryFilter)
    if (filtered.length > 0) pool = filtered
  }

  if (pool.length === 0) {
    return toolJson({
      error: `没有找到匹配的 tip。category="${categoryFilter}" 无匹配项。`,
      available_categories: [...new Set(SEED_TIPS.map(t => t.category))],
    }, false)
  }

  // 按日期确定性选择
  const idx = hashDate(date) % pool.length
  const tip = pool[idx]

  return toolJson({
    tip: {
      title: tip.title,
      content: tip.content,
      category: tip.category || 'general',
      actionable_advice: tip.actionable_advice || '',
      source: tip.source || (sourceType === 'user' ? '用户自定义' : '小盾反诈知识库'),
    },
    source_type: sourceType,
    date,
    total_seed_tips: SEED_TIPS.length,
    hint: '可设置 manage_reminder 实现每日定时推送。用户可在 data/user-tips.json 添加自定义 tips。',
  })
}
