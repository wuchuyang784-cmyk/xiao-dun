// 列出所有 threads 的概况
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const conn = Database('e:/xiao-dun/data/jarvis.db')

console.log('=== Threads ===')
const threads = conn.prepare("SELECT id, title, created_at, updated_at FROM threads ORDER BY updated_at DESC LIMIT 10").all()
for (const t of threads) {
  const msgCount = conn.prepare("SELECT COUNT(*) as cnt FROM thread_messages WHERE thread_id = ?").get(t.id).cnt
  console.log(`${t.id.slice(0,8)} | ${t.title || '(no title)'} | msgs=${msgCount} | updated=${t.updated_at}`)
}

console.log('\n=== Recent messages from active thread ===')
const active = conn.prepare("SELECT * FROM threads ORDER BY updated_at DESC LIMIT 1").get()
if (active) {
  const msgs = conn.prepare("SELECT role, content FROM thread_messages WHERE thread_id = ? ORDER BY id DESC LIMIT 5").all(active.id)
  for (const m of msgs.reverse()) {
    const preview = (m.content || '').slice(0, 60).replace(/\n/g, ' ')
    console.log(`[${m.role}] ${preview}${m.content?.length > 60 ? '...' : ''}`)
  }
}

conn.close()