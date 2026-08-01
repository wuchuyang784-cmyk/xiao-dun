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
