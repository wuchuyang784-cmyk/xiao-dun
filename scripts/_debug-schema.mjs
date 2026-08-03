import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const db = require('better-sqlite3')('e:/xiao-dun/data/jarvis.db')
const cols = db.prepare("PRAGMA table_info('memories')").all()
console.log(cols.map(c => c.name + ':' + c.type).join(', '))
db.close()