import assert from 'node:assert/strict'
import test from 'node:test'

import { combineInboundChatContent } from '../src/api/inbound-media.js'
import {
  normalizeExplicitCommandMessage,
  resolveCapabilityIntent,
  resolveExplicitCommand,
} from '../src/capabilities/intent-resolver.js'

const IMAGE = '![pasted image](/media/chat/example.png)'

test('an uploaded image keeps a slash risk command at the beginning of the queued turn', () => {
  assert.equal(
    combineInboundChatContent('/risk_assess 分析图片是否有诈骗风险', IMAGE),
    `/risk_assess 分析图片是否有诈骗风险\n\n${IMAGE}`,
  )
  assert.equal(
    combineInboundChatContent('分析图片是否有诈骗风险', IMAGE),
    `${IMAGE}\n\n分析图片是否有诈骗风险`,
  )

  assert.equal(
    normalizeExplicitCommandMessage(`${IMAGE}\n\n/risk_assess 分析图片是否有诈骗风险`),
    '/risk_assess 分析图片是否有诈骗风险',
  )
})

test('legacy image-first slash command still resolves to the local risk assessment path', async () => {
  const message = `${IMAGE}\n\n/risk_assess 分析图片是否有诈骗风险`
  assert.equal(resolveExplicitCommand(message), 'fraud-risk-assessment')

  const intent = await resolveCapabilityIntent(message, {
    callLLM: async () => {
      throw new Error('explicit command must not invoke the LLM router')
    },
  })
  assert.deepEqual(intent, { capabilityId: 'fraud-risk-assessment', via: 'command' })
})

test('a current image with a direct fraud-risk question bypasses the general chat loop', async () => {
  const intent = await resolveCapabilityIntent(`${IMAGE}\n\n这张截图有没有诈骗风险？`, {
    callLLM: async () => {
      throw new Error('image risk routing must not invoke the LLM router')
    },
  })
  assert.deepEqual(intent, { capabilityId: 'fraud-risk-assessment', via: 'image_risk' })
})
