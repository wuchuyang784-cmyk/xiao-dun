// 清掉污染的 persona 和缓存的工具调用历史
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')
const conn = Database('e:/xiao-dun/data/jarvis.db')
const p = conn.prepare("SELECT value FROM config WHERE key='persona'").get()
if (p) {
  console.log('Current persona (len=' + p.value.length + '):', p.value.slice(0, 80))
  conn.prepare("DELETE FROM config WHERE key IN ('persona', 'persona_updated_at')").run()
  console.log('Cleared')
} else {
  console.log('No persona found, nothing to clear')
}
const remaining = conn.prepare("SELECT key FROM config WHERE key LIKE 'persona%'").all()
console.log('Remaining persona configs:', remaining)
conn.close()