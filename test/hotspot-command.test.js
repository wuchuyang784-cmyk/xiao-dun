import test from 'node:test'
import assert from 'node:assert/strict'

import { executeTool } from '../src/capabilities/executor.js'
import { isHotspotOpenCommand } from '../src/capabilities/hotspot-command.js'
import {
  resolveCapabilityIntent,
  resolveExplicitCommand,
} from '../src/capabilities/intent-resolver.js'
import { classifyActionContract } from '../src/runtime/action-contract.js'

test('only /hot is recognized as the hotspot open command', () => {
  assert.equal(isHotspotOpenCommand('/hot'), true)
  assert.equal(isHotspotOpenCommand('  /hot  '), true)
  assert.equal(isHotspotOpenCommand('打开实时热点'), false)
  assert.equal(isHotspotOpenCommand('/打开实时热点'), false)
  assert.equal(resolveExplicitCommand('/hot'), 'hotspot')
  assert.equal(resolveExplicitCommand('/打开实时热点'), null)
  assert.equal(resolveExplicitCommand('/热点'), null)
  assert.equal(resolveExplicitCommand('/hotspot'), null)
})

test('natural-language hotspot requests cannot be forced by intent routing', async () => {
  const intent = await resolveCapabilityIntent('打开实时热点', {
    callLLM: async () => ({
      content: JSON.stringify({ capability: 'hotspot', reason: '用户想看热点' }),
    }),
  })
  assert.equal(intent, null)
  assert.equal(classifyActionContract('打开实时热点'), null)
  assert.equal(classifyActionContract('/hot'), null)
})

test('hotspot tool rejects opening unless the current message is the command', async () => {
  await executeTool('hotspot_mode', { action: 'hide' }, { currentUserMessage: '关闭热点' })

  const rejected = JSON.parse(await executeTool(
    'hotspot_mode',
    { action: 'show' },
    { currentUserMessage: '打开实时热点' },
  ))
  assert.equal(rejected.ok, false)

  const opened = JSON.parse(await executeTool(
    'hotspot_mode',
    { action: 'show' },
    { currentUserMessage: '/hot' },
  ))
  assert.equal(opened.ok, true)
  assert.equal(opened.state.active, true)

  await executeTool('hotspot_mode', { action: 'hide' }, { currentUserMessage: '关闭热点' })
})
