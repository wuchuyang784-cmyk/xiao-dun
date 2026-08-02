import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'

import { handleRagRoutes } from '../src/api/routes/rag.js'

function requestWithJson(body) {
  const req = new PassThrough()
  req.method = 'POST'
  req.headers = { 'content-type': 'application/json; charset=utf-8' }
  queueMicrotask(() => req.end(Buffer.from(JSON.stringify(body), 'utf8')))
  return req
}

function responseRecorder() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode
      this.headers = headers
    },
    end(body = '') {
      this.body = String(body)
    },
  }
}

test('POST fraud case search is a Node business route over the internal RAG service', async () => {
  const req = requestWithJson({ query_text: '出售银行卡收款', top_k: 3 })
  const res = responseRecorder()
  let received
  const handled = await handleRagRoutes(
    req,
    res,
    new URL('http://localhost/api/v1/fraud-cases/search'),
    {
      search: async (input) => {
        received = input
        return { request_id: 'route-1', items: [{ risk_category_code: 'fake_bank_card' }] }
      },
    },
  )

  assert.equal(handled, true)
  assert.equal(received.queryText, '出售银行卡收款')
  assert.equal(received.topK, 3)
  assert.equal(res.statusCode, 200)
  const envelope = JSON.parse(res.body)
  assert.equal(envelope.request_id, 'route-1')
  assert.equal(envelope.data.items[0].risk_category_code, 'fake_bank_card')
})

test('POST RAG activation exposes readiness without reimporting vectors', async () => {
  const req = requestWithJson({})
  const res = responseRecorder()
  let checks = 0
  const handled = await handleRagRoutes(
    req,
    res,
    new URL('http://localhost/api/v1/rag/activate'),
    {
      getReadiness: async () => {
        checks += 1
        return { ready: true, expectedCount: 9975, textCount: 9975, vectorCount: 9975 }
      },
    },
  )

  assert.equal(handled, true)
  assert.equal(checks, 1)
  assert.equal(res.statusCode, 200)
  assert.equal(JSON.parse(res.body).data.vectorCount, 9975)
})

test('POST RAG items is a Node business route over AI Engine indexing', async () => {
  const req = requestWithJson({
    title: '冒充客服退款',
    text: '对方要求开启屏幕共享并转账到所谓安全账户。',
    categoryCode: 'new_risk_type',
    piiConfirmed: true,
  })
  const res = responseRecorder()
  let received
  const handled = await handleRagRoutes(req, res, new URL('http://localhost/api/v1/rag/items'), {
    addItem: async input => {
      received = input
      return { requestId: 'add-1', risk_text_id: 'manual_1', text_count: 9976, vector_count: 9976 }
    },
  })

  assert.equal(handled, true)
  assert.equal(received.categoryCode, 'new_risk_type')
  assert.equal(received.piiConfirmed, true)
  assert.equal(res.statusCode, 201)
  assert.equal(JSON.parse(res.body).data.vector_count, 9976)
})

test('POST RAG activation refuses an incomplete knowledge base', async () => {
  const req = requestWithJson({})
  const res = responseRecorder()
  await handleRagRoutes(req, res, new URL('http://localhost/api/v1/rag/activate'), {
    getReadiness: async () => ({ ready: false, expectedCount: 9975, textCount: 9975, vectorCount: 8000 }),
  })
  assert.equal(res.statusCode, 503)
  assert.equal(JSON.parse(res.body).code, 'RAG_NOT_READY')
})

test('RAG route does not consume unrelated requests', async () => {
  const handled = await handleRagRoutes(
    { method: 'GET' },
    responseRecorder(),
    new URL('http://localhost/api/v1/fraud-cases'),
  )
  assert.equal(handled, false)
})

test('province statistics route returns the RAG simulation snapshot', async () => {
  const res = responseRecorder()
  const handled = await handleRagRoutes(
    { method: 'GET' },
    res,
    new URL('http://localhost/api/v1/fraud-statistics/provinces'),
    {
      getMapStats: async () => ({
        source: 'rag_simulation',
        isSimulated: true,
        totalSamples: 10000,
        provinces: [],
      }),
    },
  )

  assert.equal(handled, true)
  assert.equal(res.statusCode, 200)
  const envelope = JSON.parse(res.body)
  assert.equal(envelope.data.source, 'rag_simulation')
  assert.equal(envelope.data.totalSamples, 10000)
})
