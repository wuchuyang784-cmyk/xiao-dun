import assert from 'node:assert/strict'
import test from 'node:test'

import { createBrainUiMarkup } from '../src/ui/brain-ui/app-shell.js'

test('brain UI renders analysis record center independently from RAG manager', () => {
  const markup = createBrainUiMarkup()

  assert.match(markup, /id="record-center-panel"/)
  assert.match(markup, /id="rag-manager-panel"/)
  assert.match(markup, /备案中心/)
  assert.match(markup, /RAG Manager/)
})
