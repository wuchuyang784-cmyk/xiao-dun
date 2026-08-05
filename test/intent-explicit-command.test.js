// Regression tests for the explicit-command fast path that powers
// /check_link and /check_sms local execution when the LLM is unavailable.
//
// Background (the bug this guards against):
//   src/index.js used to feed `msg.raw` (a channel-prefixed string such as
//   "[000001] [TUI] /check_link https://ta0bao.com") into resolveCapabilityIntent
//   / runLocalCommandTool. Because msg.raw does NOT start with '/', the explicit
//   command fast path in intent-resolver.js never matched, so the message fell
//   through to the LLM path — and when the LLM was unavailable it got dropped.
//   The fix feeds `msg.content || input` instead (which DOES start with '/').
//
// Covered here:
//   1. resolveExplicitCommand maps /check_link -> verify-link, /check_sms -> verify-sms
//      (and their Chinese aliases).
//   2. A msg.raw-style string (no leading '/') is NOT treated as an explicit command.
//   3. resolveCapabilityIntent returns {capabilityId, via:'command'} for the
//      msg.content form, with zero LLM involvement.
//
// Run: node --experimental-test-module-mocks --test test/intent-explicit-command.test.js

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  resolveExplicitCommand,
  resolveCapabilityIntent,
} from '../src/capabilities/intent-resolver.js'

// A realistic msg.raw from a TUI channel: prefixed, does NOT start with '/'.
const TUI_RAW = '[000001] [TUI] /check_link https://ta0bao.com'

test('resolveExplicitCommand: /check_link maps to verify-link', () => {
  assert.equal(resolveExplicitCommand('/check_link https://ta0bao.com'), 'verify-link')
})

test('resolveExplicitCommand: /check_sms maps to verify-sms', () => {
  assert.equal(resolveExplicitCommand('/check_sms 您的快递丢失请点链接'), 'verify-sms')
})

test('resolveExplicitCommand: alias /验链接 maps to verify-link', () => {
  assert.equal(resolveExplicitCommand('/验链接 https://example.com'), 'verify-link')
})

test('resolveExplicitCommand: alias /验短信 maps to verify-sms', () => {
  assert.equal(resolveExplicitCommand('/验短信 中奖短信'), 'verify-sms')
})

test('resolveExplicitCommand: msg.raw (no leading slash) is NOT an explicit command', () => {
  // This mirrors the regression: before the fix, index.js passed msg.raw here and
  // the fast path was missed entirely.
  assert.equal(resolveExplicitCommand(TUI_RAW), null)
})

test('resolveExplicitCommand: unknown slash command returns null', () => {
  assert.equal(resolveExplicitCommand('/no_such_command foo'), null)
})

test('resolveExplicitCommand: empty / whitespace input returns null', () => {
  assert.equal(resolveExplicitCommand(''), null)
  assert.equal(resolveExplicitCommand('   '), null)
})

test('resolveCapabilityIntent: /check_link (msg.content form) resolves via command, no LLM', async () => {
  const intent = await resolveCapabilityIntent('/check_link https://ta0bao.com', {})
  assert.ok(intent, 'expected a forced capability')
  assert.equal(intent.capabilityId, 'verify-link')
  assert.equal(intent.via, 'command')
})

test('resolveCapabilityIntent: /check_sms (msg.content form) resolves via command, no LLM', async () => {
  const intent = await resolveCapabilityIntent('/check_sms 中奖短信内容', {})
  assert.ok(intent, 'expected a forced capability')
  assert.equal(intent.capabilityId, 'verify-sms')
  assert.equal(intent.via, 'command')
})

test('resolveCapabilityIntent: msg.raw form does not hit the explicit command route', async () => {
  // The precise regression guard: the TUI raw string must not be routed as a
  // verify-link command (it lacks a leading '/').
  const intent = await resolveCapabilityIntent(TUI_RAW, {})
  assert.notEqual(intent && intent.capabilityId, 'verify-link')
})
