import assert from 'node:assert/strict'
import test from 'node:test'

import {
  RagServiceError,
  getRagMapStats,
  getRagConfig,
  searchRiskTexts,
} from '../src/services/rag-client.js'

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
