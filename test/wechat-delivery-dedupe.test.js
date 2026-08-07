import assert from 'node:assert/strict'
import test from 'node:test'
import { mock } from 'node:test'

mock.module('../src/db.js', {
  namedExports: {
    normalizeConversationPartyId: (id) => String(id || ''),
    insertConversation: () => 1001,
    markConversationOpenQuestion: () => {},
    getAllClawbotTokens: () => [{ from_user_id: 'u1' }, { from_user_id: 'u2' }],
    getDB: () => ({ prepare: () => ({ get: () => null, all: () => [], run: () => ({ changes: 0 }) }) }),
  },
})

mock.module('../src/identity.js', {
  namedExports: {
    lookupReplyTarget: () => null,
    normalizeChannel: (channel = '') => {
      const c = String(channel || '').toUpperCase()
      if (c === 'WECHAT_CLAWBOT') return 'WECHAT'
      return c
    },
    suggestProactiveChannel: () => 'TUI',
    isVoiceChannel: () => false,
  },
})

const sent = []
mock.module('../src/social/dispatch.js', {
  namedExports: {
    dispatchSocialMessage: async (targetId, payload) => {
      sent.push({ targetId, payload })
      return { ok: true, platform: 'wechat-clawbot' }
    },
  },
})

mock.module('../src/events.js', {
  namedExports: { emitEvent: () => {} },
})

const { deliverMessage } = await import('../src/runtime/delivery.js')

test('wechat replies containing 96110 are not auto-forwarded a second time', async () => {
  sent.length = 0

  await deliverMessage(
    { target_id: 'ID:000001', content: '检测报告：遇诈骗请拨打 96110。', channel: 'AUTO' },
    { currentChannel: 'WECHAT_CLAWBOT', currentExternalPartyId: 'wechat:clawbot:u1' },
  )

  assert.deepEqual(sent.map(item => item.targetId), ['wechat:clawbot:u1'])
})
