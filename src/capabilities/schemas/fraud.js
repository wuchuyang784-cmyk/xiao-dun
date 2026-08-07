export const fraudSchemas = {
  analyze_fraud_image: {
    type: 'function',
    function: {
      name: 'analyze_fraud_image',
      description: 'Analyze a chat screenshot or suspicious image for scam risk. Use it only when the user explicitly asks for fraud / risk / scam analysis. It performs OCR / vision extraction, rule screening, external RAG similar-case retrieval, link checks, persists an analysis record, and returns a structured report.',
      parameters: {
        type: 'object',
        properties: {
          image_path: { type: 'string', description: 'Local image path, file:// URL, or /media/chat/<filename> path. Optional if the current or recent conversation message already contains a Markdown image.' },
          image_url: { type: 'string', description: 'HTTP(S) image URL or data:image URL. Optional if image_path is provided.' },
          user_intent: { type: 'string', description: 'The user fraud-analysis request in their own words.' },
          top_k: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of external RAG similar cases to include. Default 5.' },
        },
        required: [],
      },
    },
  },
  search_fraud_cases: {
    type: 'function',
    function: {
      name: 'search_fraud_cases',
      description: 'Search the published anti-fraud risk-text knowledge base for semantically similar dangerous text and scam patterns. Use it to ground risk assessments of suspicious chats, payment requests, account trading, links, investment pitches, impersonation, or other suspected fraud. Results are reference texts, not real-time incident statistics.',
      parameters: {
        type: 'object',
        properties: {
          query_text: { type: 'string', description: 'The suspicious text or a concise factual description to compare against the anti-fraud knowledge base.' },
          top_k: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of results to return. Default 5.' },
          risk_category_hint: { type: 'string', description: 'Optional known category code used to widen category-aware candidate retrieval.' },
        },
        required: ['query_text'],
      },
    },
  },

  get_daily_tip: {
    type: 'function',
    function: {
      name: 'get_daily_tip',
      description: '获取每日反诈提醒，返回一条反诈小知识或演练题。覆盖刷单返利、冒充客服、冒充公检法、投资诈骗、杀猪盘、贷款诈骗等8大类型。同一天返回同一条tip。适合在TICK心跳或用户主动询问时调用。用户可在 data/user-tips.json 添加自定义tips。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期 (YYYY-MM-DD)，默认今天。同一天返回同一条tip。' },
          category: { type: 'string', description: '限定类型。可选值: brushing(刷单返利), refund_customer(冒充客服退款), impersonate_police(冒充公检法), fake_investment(虚假投资), pig_butchering(杀猪盘), loan_scam(贷款诈骗), prize_scam(中奖诈骗), nude_extortion(裸聊敲诈), general(通用), drill(演练题)' },
        },
        required: [],
      },
    },
  },

  report_fraud: {
    type: 'function',
    function: {
      name: 'report_fraud',
      description: '获取诈骗举报指引，包含举报渠道(96110反诈专线/12321网络举报/110报警/国家反诈中心APP)、举报步骤、证据保全建议。按诈骗类型给出针对性指导。适合在用户表示要举报诈骗或询问如何报案时调用。',
      parameters: {
        type: 'object',
        properties: {
          fraud_type: { type: 'string', description: '诈骗类型。可选值: brushing(刷单返利), refund_customer(冒充客服退款), impersonate_police(冒充公检法), fake_investment(虚假投资), pig_butchering(杀猪盘), loan_scam(贷款诈骗), general(通用)。默认 general。' },
          description: { type: 'string', description: '诈骗情况描述（可选），用于给出更有针对性的建议' },
        },
        required: [],
      },
    },
  },

  search_law: {
    type: 'function',
    function: {
      name: 'search_law',
      description: '检索反诈相关法律法规条文。内置15条核心法规，覆盖反电信网络诈骗法、刑法诈骗罪(266条)、治安管理处罚法、个人信息保护法等。支持关键词匹配。离线可用，不依赖外部数据库。适合在用户询问诈骗相关法律条文、量刑标准时调用。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词，如"诈骗罪""反诈法""量刑""个人信息"等' },
          limit: { type: 'integer', minimum: 1, maximum: 15, description: '返回结果数量上限，默认5' },
        },
        required: ['query'],
      },
    },
  },

  check_qrcode: {
    type: 'function',
    function: {
      name: 'check_qrcode',
      description: '分析二维码内容的安全性。支持URL安全检测(HTTPS/HTTP、仿冒域名、可疑TLD、钓鱼参数)、支付内容检测、钓鱼关键词检测。返回风险评分和处置建议。不做二维码图片解码，只分析扫描后得到的内容字符串。适合在用户扫描二维码后想检查安全性时调用。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '二维码扫描后得到的内容（URL、文本、电话号码等）' },
        },
        required: ['content'],
      },
    },
  },

  verify_identity: {
    type: 'function',
    function: {
      name: 'verify_identity',
      description: '综合身份核实工具。对电话号码、URL、聊天文本进行多维度风险分析：①本地反诈规则引擎匹配诈骗话术模式 ②URL安全检测(仿冒域名/钓鱼参数) ③电话号码模式分析(虚拟号段/国际号码)。输出综合风险等级和处置建议。不依赖RAG，完全离线可用。适合在用户提交可疑信息需要综合判断时调用。',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: '待核实的电话号码（可选）' },
          url: { type: 'string', description: '待核实的URL链接（可选）' },
          text: { type: 'string', description: '待核实的聊天文本/消息内容（可选）' },
          name: { type: 'string', description: '待核实的对方名称/自称身份（可选）' },
        },
        required: [],
      },
    },
  },
}
