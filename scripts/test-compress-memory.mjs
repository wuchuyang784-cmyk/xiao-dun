// 测试压缩摘要是否能被记忆系统检索
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const conn = Database('e:/xiao-dun/data/jarvis.db')

console.log('=== 1. 当前上下文消息数 ===')
const before = conn.prepare("SELECT COUNT(*) as c FROM conversations").get()
console.log('消息数:', before.c)

// 注入 15 轮测试对话
if (before.c < 12) {
  console.log('\n=== 2. 注入 30 条测试消息 ===')
  const ins = conn.prepare("INSERT INTO conversations (role, content, from_id, timestamp) VALUES (?,?,?,?)")
  for (let i = 1; i <= 15; i++) {
    const ts = new Date(Date.now() - i * 120000).toISOString()
    ins.run('user', `用户第${i}次提问：AI防幻觉需要控制上下文长度，旧对话应压缩为摘要存记忆`, 'test-user', ts)
    ins.run('jarvis', `小盾第${i}次回复：我会控制上下文长度，避免重复输出`, 'jarvis', ts)
  }
  console.log('注入完成')
}

const after = conn.prepare("SELECT COUNT(*) as c FROM conversations").get()
console.log('消息数:', after.c)

// 3. 调用 API 压缩
console.log('\n=== 3. 调用压缩 API ===')
const compressRes = await fetch('http://127.0.0.1:3721/api/v1/context/compress', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ keep_recent: 8 }),
})
const compressEnv = await compressRes.json()
const d = compressEnv.data || {}
console.log('压缩结果:', {
  compressed: d.compressed,
  before: d.before,
  after: d.after,
  removed: d.removed,
  mem_id: d.mem_id,
  summary: d.summary_preview,
})

if (!d.compressed) {
  console.log('未触发压缩（消息数可能不足）')
  // 清理
  conn.prepare("DELETE FROM conversations WHERE from_id = 'test-user'").run()
  conn.close()
  process.exit(0)
}

// 4. 验证记忆存储
console.log('\n=== 4. 验证摘要记忆 ===')
const mems = conn.prepare(`
  SELECT mem_id, title, length(content) as len, substr(content,1,80) as preview, salience, event_type
  FROM memories
  WHERE mem_id LIKE 'ctx-summary%'
  ORDER BY timestamp DESC
  LIMIT 3
`).all()
for (const m of mems) {
  console.log({
    mem_id: (m.mem_id||'').slice(0, 30) + '...',
    title: m.title,
    salience: m.salience,
    event_type: m.event_type,
    len: m.len,
    preview: m.preview,
  })
}

// 5. 验证消息压缩效果
const finalCount = conn.prepare("SELECT COUNT(*) as c FROM conversations").get()
console.log('\n=== 5. 最终消息数 ===')
console.log('compress前:', after.c, '→ compress后:', finalCount.c)
console.log('保留率:', Math.round(finalCount.c / after.c * 100) + '%')

// 6. 验证 memory/injector 是否可检索
console.log('\n=== 6. 记忆系统检索测试 ===')
const retrievable = conn.prepare(`
  SELECT mem_id, substr(content,1,60) as preview
  FROM memories
  WHERE content LIKE '%对话时间%' AND event_type = 'context_compression'
  ORDER BY timestamp DESC LIMIT 1
`).get()
if (retrievable) {
  console.log('✅ 记忆可检索:', retrievable.preview)
} else {
  console.log('❌ 记忆无法检索')
}

// 7. 清理测试数据
conn.prepare("DELETE FROM conversations WHERE from_id = 'test-user'").run()
conn.prepare("DELETE FROM memories WHERE mem_id LIKE 'ctx-summary%'").run()
const clean = conn.prepare("SELECT COUNT(*) as c FROM conversations").get()
console.log('\n清理后消息数:', clean.c)
console.log('\n✅ 压缩测试完成')
conn.close()