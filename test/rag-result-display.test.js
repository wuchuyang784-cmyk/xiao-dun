import assert from 'node:assert/strict'
import test from 'node:test'

import { formatRagSearchDetail } from '../src/ui/brain-ui/thought-stream.js'

test('RAG tool result gets a readable dedicated summary', () => {
  const detail = formatRagSearchDetail({
    ok: true,
    items: [
      {
        title: '银行卡收款话术',
        risk_category_name: '虚假银行卡与账户交易',
        similarity_score: 0.91,
      },
      {
        title: '对公账户出租',
        risk_category_name: '虚假银行卡与账户交易',
        similarity_score: 0.87,
      },
    ],
  })

  assert.match(detail, /命中 2 条/)
  assert.match(detail, /银行卡收款话术/)
  assert.match(detail, /91%/)
})

test('RAG tool result clearly reports no reliable match', () => {
  assert.equal(
    formatRagSearchDetail({ ok: true, items: [] }),
    '未找到达到可信阈值的反诈案例。',
  )
})
