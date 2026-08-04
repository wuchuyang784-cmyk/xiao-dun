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
}
