// 测试上下文压缩是否有效
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const conn = Database('e:/xiao-dun/data/jarvis.db')

console.log('=== 1. 当前上下文状态 ===')
const before = conn.prepare("SELECT COUNT(*) as cnt FROM conversations").get()
const msgs = conn.prepare("SELECT id, role, length(content) as len, substr(content,1,40) as preview FROM conversations ORDER BY id DESC LIMIT 20").all()
console.log(`总消息数: ${before.cnt}`)
for (const m of msgs.reverse()) {
  console.log(`  #${m.id} [${m.role}] ${m.len}c: ${m.preview}...`)
}

// 2. 模拟大量消息（如果不够）
if (before.cnt < 12) {
  console.log('\n=== 2. 模拟添加大量消息 ===')
  const insert = conn.prepare("INSERT INTO conversations (role, content, from_id, timestamp) VALUES (?, ?, ?, ?)")
  for (let i = 0; i < 20; i++) {
    insert.run('user', `第${i+1}条测试消息：这是一条比较长的用户输入用于模拟真实对话场景，包含中文和英文混合内容 to test token estimation accuracy and context compression with lots of CJK characters。`, 'test-user', String(Date.now() + i * 1000))
  }
  console.log('已插入 20 条模拟消息')
}

// 3. 再次统计
const afterAdd = conn.prepare("SELECT COUNT(*) as cnt FROM conversations").get()
console.log(`\n当前消息总数: ${afterAdd.cnt}`)

// 4. 模拟压缩逻辑（保留最近 8 条）
const limit = 8
const all = conn.prepare("SELECT id, role, content, timestamp FROM conversations ORDER BY id ASC").all()
if (all.length > limit) {
  const toKeep = all.slice(-limit).map(r => r.id)
  const toDelete = all.slice(0, -limit)
  console.log(`\n=== 3. 模拟压缩 ===`)
  console.log(`保留最近 ${limit} 条`)
  console.log(`待删除: ${toDelete.length} 条`)
  
  const del = conn.prepare("DELETE FROM conversations WHERE id = ?")
  conn.transaction(() => {
    for (const row of toDelete) {
      del.run(row.id)
    }
  })()
  
  const after = conn.prepare("SELECT COUNT(*) as cnt FROM conversations").get()
  const removed = afterAdd.cnt - after.cnt
  console.log(`压缩前: ${afterAdd.cnt} 条 → 压缩后: ${after.cnt} 条 (减少 ${removed} 条)`)
  console.log(`\n${removed > 0 ? '✅ 压缩有效！删除了 ' + removed + ' 条旧消息' : '❌ 压缩未生效'}`)
}

// 5. 清理测试数据
conn.prepare("DELETE FROM conversations WHERE from_id = 'test-user'").run()
const clean = conn.prepare("SELECT COUNT(*) as cnt FROM conversations").get()
console.log(`\n清理后: ${clean.cnt} 条`)

conn.close()