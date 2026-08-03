// 列出 DB 表结构
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const conn = Database('e:/xiao-dun/data/jarvis.db')
const tables = conn.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()
for (const t of tables) {
  console.log(`\n=== ${t.name} ===`)
  const cols = conn.prepare(`PRAGMA table_info('${t.name}')`).all()
  for (const c of cols) console.log(`  ${c.name}: ${c.type}`)
}
conn.close()