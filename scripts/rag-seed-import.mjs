// 导入 RAG 种子数据到 PostgreSQL（9975 条诈骗案例 + 向量嵌入 + 34 省地图）
// 用法：npm run rag:db:import
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const gzPath = path.join(projectRoot, 'rag-service', 'seed', 'xiaodun-rag-kb-v1.sql.gz');

console.log('[rag:seed] Importing RAG seed data...');
console.log('[rag:seed] Source: ' + gzPath);

// psql 容器内命令（绕过事务，允许部分错误不影响 INSERT）
const psql = spawn('docker', [
  'exec', '-i', 'rag-service-postgres-1',
  'psql', '-U', 'xiaodun', '-d', 'xiaodun',
], { stdio: ['pipe', 'inherit', 'inherit'] });

const source = createReadStream(gzPath);
const gunzip = createGunzip();

try {
  await pipeline(source, gunzip, psql.stdin);
  psql.stdin.end();
  const code = await new Promise(resolve => psql.on('close', resolve));
  if (code !== 0) {
    console.error('[rag:seed] Import failed with exit code ' + code);
    process.exit(1);
  }
  console.log('[rag:seed] RAG seed data imported successfully.');
} catch (error) {
  console.error('[rag:seed] Import error:', error.message);
  process.exit(1);
}
