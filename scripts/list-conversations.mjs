// 查看最近的对话消息和配置
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const conn = Database('e:/xiao-dun/data/jarvis.db')

console.log('=== Config ===')
const config = conn.prepare("SELECT key, length(value) as len, value FROM config").all()
for (const c of config) {
  const preview = c.value ? c.value.slice(0, 60).replace(/\n/g, ' ') : ''
  console.log(`  ${c.key} (${c.len}): ${preview}${c.value?.length > 60 ? '...' : ''}`)
}

console.log('\n=== Last 8 messages ===')
const msgs = conn.prepare("SELECT id, role, from_id, length(content) as len, content FROM conversations ORDER BY id DESC LIMIT 8").all()
for (const m of msgs.reverse()) {
  const preview = (m.content || '').slice(0, 80).replace(/\n/g, ' ')
  console.log(`#${m.id} [${m.role}/${m.from_id}] ${m.len}c: ${preview}${m.content?.length > 80 ? '...' : ''}`)
}

conn.close()