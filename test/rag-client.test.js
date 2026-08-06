import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RagServiceError,
  addRiskText,
  getRagMapStats,
  getRagReadiness,
  getRagConfig,
  searchRiskTexts,
} from '../src/services/rag-client.js'
import {
  formatToolResultForModel,
  truncateToolResultForUI,
} from '../src/runtime/tool-result-preview.js'

test('addRiskText sends a manual item for server-side document embedding', async () => {
  let captured
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({
      code: 0,
      request_id: 'add-1',
      data: { risk_text_id: 'manual_1', text_count: 9976, vector_count: 9976, embedding_dimension: 512 },
    }), { status: 201, headers: { 'content-type': 'application/json' } })
  }
  const result = await addRiskText({
    title: '冒充客服退款',
    text: '对方要求开启屏幕共享并转账到所谓安全账户。',
    categoryCode: 'new_risk_type',
    riskSignals: '屏幕共享，安全账户',
    keyPhrases: '退款理赔',
    piiConfirmed: true,
    requestId: 'add-1',
  }, { fetchImpl })

  assert.equal(captured.url, 'http://127.0.0.1:8001/internal/v1/rag/items')
  assert.equal(captured.body.query_embedding, undefined)
  assert.deepEqual(captured.body.risk_signals, ['屏幕共享', '安全账户'])
  assert.equal(captured.body.pii_confirmed, true)
  assert.equal(result.vector_count, 9976)
})

test('getRagReadiness verifies all seeded texts and vectors before UI activation', async () => {
  let requestedUrl = ''
  const fetchImpl = async (url) => {
    requestedUrl = url
    return new Response(JSON.stringify({
      code: 0,
      data: {
        ready: true,
        status: 'ready',
        knowledge_base_version: 'kb_chifraud_competition_v1',
        expected_count: 9975,
        text_count: 9975,
        vector_count: 9975,
        embedding_model: 'BAAI/bge-small-zh-v1.5',
        embedding_dimension: 512,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const readiness = await getRagReadiness({ fetchImpl })
  assert.equal(requestedUrl, 'http://127.0.0.1:8001/internal/v1/rag/readiness')
  assert.equal(readiness.ready, true)
  assert.equal(readiness.textCount, 9975)
  assert.equal(readiness.vectorCount, 9975)
  assert.equal(readiness.embeddingDimension, 512)
})

test('getRagConfig defaults to the existing local AI Engine', () => {
  assert.deepEqual(getRagConfig({}), {
    baseUrl: 'http://127.0.0.1:8001',
    timeoutMs: 30_000,
    knowledgeBaseVersion: 'kb_chifraud_competition_v1',
  })
})

test('searchRiskTexts sends text to AI Engine without a Node-generated embedding', async () => {
  let captured
  const fetchImpl = async (url, options) => {
    captured = { url, options, body: JSON.parse(options.body) }
    return new Response(JSON.stringify({
      code: 0,
      message: 'success',
      request_id: 'req-1',
      data: {
        knowledge_base_version: 'kb_chifraud_competition_v1',
        embedding_model: 'BAAI/bge-small-zh-v1.5',
        reranked: false,
        items: [{ risk_text_id: 'risk-1', risk_category_code: 'fake_bank_card' }],
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }

  const result = await searchRiskTexts({
    queryText: '有人出售银行卡和对公账户，用来收款转账',
    topK: 5,
    requestId: 'req-1',
  }, {
    fetchImpl,
    config: {
      baseUrl: 'http://rag.internal:8001/',
      timeoutMs: 2_000,
      knowledgeBaseVersion: 'kb_chifraud_competition_v1',
    },
  })

  assert.equal(captured.url, 'http://rag.internal:8001/internal/v1/rag/search')
  assert.equal(captured.options.method, 'POST')
  assert.equal(captured.options.headers['X-Request-ID'], 'req-1')
  assert.equal(captured.body.query_text, '有人出售银行卡和对公账户，用来收款转账')
  assert.equal(captured.body.query_embedding, undefined)
  assert.equal(captured.body.top_k, 5)
  assert.equal(captured.body.candidate_k, 50)
  assert.equal(captured.body.knowledge_base_version, 'kb_chifraud_competition_v1')
  assert.equal(result.items[0].risk_category_code, 'fake_bank_card')
})

test('searchRiskTexts maps upstream failures to a service-unavailable error', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    code: 50004,
    message: 'embedding unavailable',
    data: null,
  }), { status: 503, headers: { 'content-type': 'application/json' } })

  await assert.rejects(
    searchRiskTexts({ queryText: '测试诈骗话术' }, { fetchImpl }),
    (error) => error instanceof RagServiceError
      && error.statusCode === 503
      && error.code === 'RAG_UPSTREAM_ERROR',
  )
})

test('searchRiskTexts rejects empty queries before calling the service', async () => {
  let called = false
  await assert.rejects(
    searchRiskTexts({ queryText: '   ' }, { fetchImpl: async () => { called = true } }),
    (error) => error instanceof RagServiceError
      && error.statusCode === 400
      && error.code === 'INVALID_RAG_QUERY',
  )
  assert.equal(called, false)
})

test('getRagMapStats adapts simulated province aggregates for the existing map', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    code: 0,
    data: {
      simulation_version: 'competition_demo_v1',
      data_source: 'ChiFraud (COLING 2025)',
      total_samples: 10000,
      is_simulated: true,
      disclaimer: 'simulated data, does not represent real regional risk',
      provinces: [
        { province_code: '110000', province_name: 'Beijing', sample_count: 332, is_simulated: true },
        { province_code: '440000', province_name: 'Guangdong', sample_count: 692, is_simulated: true },
      ],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })

  const snapshot = await getRagMapStats({ fetchImpl })

  assert.equal(snapshot.source, 'rag_simulation')
  assert.equal(snapshot.isSimulated, true)
  assert.equal(snapshot.totalSamples, 10000)
  assert.equal(snapshot.provinces[0].provinceName, '北京市')
  assert.equal(snapshot.provinces[1].provinceName, '广东省')
  assert.equal(snapshot.provinces[1].caseCount, 692)
  assert.equal(snapshot.provinces[1].sampleCount, 692)
})

function longRagResult() {
  return {
    ok: true,
    tool: 'search_fraud_cases',
    knowledge_base_version: 'kb_chifraud_competition_v1',
    reranked: true,
    items: Array.from({ length: 5 }, (_, index) => ({
      risk_text_id: `risk-${index + 1}`,
      title: `诈骗案例 ${index + 1}`,
      risk_category_code: index % 2 ? 'fake_bank_card' : 'fake_certification',
      risk_category_name: index % 2 ? '虚假银行卡与账户交易' : '虚假认证',
      normalized_text: `案例正文 ${index + 1}：${'诱导转账并索要验证码。'.repeat(120)}`,
      similarity_score: 0.88 - index * 0.02,
      similarity_level: 'high',
      similarity_reason: '语义相似且包含共同风险信号',
    })),
  }
}

test('RAG UI preview stays valid JSON and preserves all top five matches', () => {
  const result = longRagResult()
  const preview = truncateToolResultForUI(result, JSON.stringify(result))

  assert.ok(preview.length <= 4000)
  const parsed = JSON.parse(preview)
  assert.equal(parsed.items.length, 5)
  assert.equal(parsed.items[4].risk_text_id, 'risk-5')
})

test('XML-compatible model result keeps structured top five RAG matches', () => {
  const result = longRagResult()
  const modelResult = formatToolResultForModel('search_fraud_cases', JSON.stringify(result))

  assert.ok(modelResult.length > 300)
  const parsed = JSON.parse(modelResult)
  assert.equal(parsed.items.length, 5)
  assert.equal(parsed.items[4].risk_text_id, 'risk-5')
})
