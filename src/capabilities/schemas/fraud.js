export const fraudSchemas = {
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
  check_link: {
    type: 'function',
    function: {
      name: 'check_link',
      description: 'Verify a single URL for phishing / scam risk using fully local heuristics (no network). Detects typosquatting of brand domains, homoglyph / IDN look-alikes, URL shorteners, bare IP hosts, suspicious TLDs, inducement words, and brand-impersonation abuse. Returns a structured risk score, level, findings, and advice. Optionally pass llm:true to add an LLM judgment layer that degrades gracefully if unavailable.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The raw URL / link to verify.' },
          llm: { type: 'boolean', description: 'Optional. Set true to also run an LLM analysis layer (degrades gracefully if the model is unavailable). Default false.' },
        },
        required: ['url'],
      },
    },
  },
  check_sms: {
    type: 'function',
    function: {
      name: 'check_sms',
      description: 'Analyze a suspicious SMS / chat transcript / transfer-invite text. Reuses the fraud rule engine for scam-script matching and the RAG knowledge base for similar-case retrieval, then assembles a structured risk breakdown (script evidence, playbook, similar cases, advice). Returns a report plus structured fields. Pass llm:true for an optional LLM judgment layer that degrades gracefully.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The original suspicious text to analyze.' },
          top_k: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of similar RAG cases to return. Default 5.' },
          llm: { type: 'boolean', description: 'Optional. Set true to also run an LLM analysis layer (degrades gracefully if the model is unavailable). Default false.' },
        },
        required: ['text'],
      },
    },
  },
  analyze_fraud_image: {
    type: 'function',
    function: {
      name: 'analyze_fraud_image',
      description: 'Analyze an uploaded chat screenshot or suspicious image for scam risk. Use only when the current message contains an image and the user explicitly asks for fraud, scam, or risk analysis. Performs vision OCR, scam-rule screening, external RAG similar-case retrieval, link checks, and returns a structured report.',
      parameters: {
        type: 'object',
        properties: {
          image_path: { type: 'string', description: 'Local image path, file:// URL, or /media/chat/<filename>. Optional when the current message contains a Markdown image.' },
          image_url: { type: 'string', description: 'http(s) image URL or data:image URL. Optional when image_path is provided.' },
          user_intent: { type: 'string', description: 'The user’s fraud-analysis request in their own words.' },
          top_k: { type: 'integer', minimum: 1, maximum: 20, description: 'Number of external RAG similar cases to include. Default 5.' },
        },
        required: [],
      },
    },
  },
  get_daily_tip: {
    type: 'function',
    function: {
      name: 'get_daily_tip',
      description: '获取每日反诈提醒，返回一条反诈小知识或演练题。同一天返回同一条提醒。',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: '日期 (YYYY-MM-DD)，默认今天。' },
          category: { type: 'string', description: '可选诈骗类型分类。' },
        },
        required: [],
      },
    },
  },
  report_fraud: {
    type: 'function',
    function: {
      name: 'report_fraud',
      description: '获取诈骗举报渠道、步骤和证据保全指引。',
      parameters: {
        type: 'object',
        properties: {
          fraud_type: { type: 'string', description: '诈骗类型，默认 general。' },
          description: { type: 'string', description: '诈骗情况描述。' },
        },
        required: [],
      },
    },
  },
  search_law: {
    type: 'function',
    function: {
      name: 'search_law',
      description: '离线检索反诈相关法律法规和量刑条文。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '检索关键词。' },
          limit: { type: 'integer', minimum: 1, maximum: 15, description: '返回数量上限，默认 5。' },
        },
        required: ['query'],
      },
    },
  },
  check_qrcode: {
    type: 'function',
    function: {
      name: 'check_qrcode',
      description: '分析二维码扫描结果中的链接、支付或钓鱼风险；不负责图片解码。',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: '二维码扫描后得到的内容。' },
        },
        required: ['content'],
      },
    },
  },
  verify_identity: {
    type: 'function',
    function: {
      name: 'verify_identity',
      description: '通过电话号码、URL 和聊天文本进行本地身份风险核实。',
      parameters: {
        type: 'object',
        properties: {
          phone: { type: 'string', description: '待核实电话号码。' },
          url: { type: 'string', description: '待核实链接。' },
          text: { type: 'string', description: '待核实聊天文本。' },
          name: { type: 'string', description: '对方名称或自称身份。' },
        },
        required: [],
      },
    },
  },
}
