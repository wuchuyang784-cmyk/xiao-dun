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
}
