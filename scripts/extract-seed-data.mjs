// 提取种子 SQL 中 INSERT/COPY 语句，跳过 CREATE TABLE / 约束
// 用法：node scripts/extract-seed-data.mjs | docker exec -i rag-service-postgres-1 psql -U xiaodun -d xiaodun
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sqlPath = path.join(projectRoot, 'rag-service', 'seed', 'xiaodun-rag-kb-v1.sql', 'xiaodun-rag-kb-v1.sql')

const content = fs.readFileSync(sqlPath, 'utf8')

// 匹配 SQL 语句：以 INSERT 或 COPY 开头，到分号+换行结束
const re = /(?:INSERT\s+INTO\s+[\s\S]*?;|COPY\s+\S+\s*\([^)]*\)\s+FROM\s+stdin;\n[\s\S]*?\\\.)\n/g

let count = 0
for (const match of content.matchAll(re)) {
  process.stdout.write(match[0] + '\n')
  count++
}

if (count === 0) {
  process.stderr.write('[extract-seed] No INSERT/COPY statements found in ' + sqlPath + '\n')
  process.exit(1)
}
process.stderr.write('[extract-seed] Extracted ' + count + ' statements\n')
