import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

// 测试 upsertMemoryByMemId 是否正常工作
const { upsertMemoryByMemId } = await import('../src/db.js')

try {
  const memId = 'test-ctx-' + Date.now()
  upsertMemoryByMemId({
    mem_id: memId,
    event_type: 'context_compression',
    content: '测试摘要：对话共30条，涉及反诈和AI话题',
    title: '测试压缩摘要',
    salience: 3,
    source_ref: 'test',
    timestamp: new Date().toISOString(),
  })
  console.log('upsert OK, mem_id:', memId)

  // 验证存储
  const Database = require('better-sqlite3')
  const conn = Database('e:/xiao-dun/data/jarvis.db')
  const found = conn.prepare("SELECT mem_id, title, content FROM memories WHERE mem_id = ?").get(memId)
  if (found) {
    console.log('✅ 记忆存储成功:', found.title, '-', found.content.slice(0, 50))
    // 清理
    conn.prepare("DELETE FROM memories WHERE mem_id LIKE 'test-ctx%'").run()
  } else {
    console.log('❌ 记忆未存储到 DB')
  }
  conn.close()
} catch (e) {
  console.error('❌ upsert FAILED:', e.message)
  process.exit(1)
}