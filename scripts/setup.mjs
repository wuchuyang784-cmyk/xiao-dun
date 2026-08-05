// 小盾（XiaoDun）统一依赖安装脚本
// 一键安装 Node.js 前端/后端依赖 + RAG AI Engine Python 依赖
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ragRoot = path.join(projectRoot, 'rag-service', 'ai-engine');
const requirementsFile = path.join(ragRoot, 'requirements.txt');

let exitCode = 0;

// ---- Step 1: 检查 Node.js ----
const nodeVersion = process.versions.node.split('.').map(Number);
if (nodeVersion[0] < 22) {
  console.error('[setup] Node.js >= 22 is required, current: ' + process.version);
  process.exit(1);
}
console.log('[setup] Node.js ' + process.version + '  ✔');

// ---- Step 2: npm install ----
console.log('[setup] Running npm install ...');
const npmResult = spawnSync('npm', ['install'], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: true,
});
if (npmResult.status !== 0) {
  console.error('[setup] npm install failed (code ' + npmResult.status + ')');
  exitCode = 1;
} else {
  console.log('[setup] npm install  ✔');
}

// ---- Step 3: 检查 Python ----
const pythonCommands = ['python', 'python3'];
let pythonCommand = null;
let pythonVersion = null;

for (const cmd of pythonCommands) {
  const result = spawnSync(cmd, ['--version'], {
    cwd: ragRoot,
    stdio: 'pipe',
    encoding: 'utf8',
    shell: true,
  });
  if (result.status === 0 && result.stdout) {
    pythonCommand = cmd;
    pythonVersion = result.stdout.trim();
    break;
  }
}

if (!pythonCommand) {
  console.warn('[setup] Python not found in PATH, skipping RAG Python dependencies.');
  console.warn('[setup] To use RAG (fraud case knowledge base), please install Python 3.10+');
  console.warn('[setup] and run: pip install -r rag-service/ai-engine/requirements.txt');
} else {
  console.log('[setup] ' + pythonVersion + '  ✔');

  // ---- Step 4: pip install RAG dependencies ----
  if (fs.existsSync(requirementsFile)) {
    console.log('[setup] Running pip install -r rag-service/ai-engine/requirements.txt ...');
    const pipResult = spawnSync(pythonCommand, ['-m', 'pip', 'install', '-r', requirementsFile], {
      cwd: ragRoot,
      stdio: 'inherit',
      shell: true,
    });
    if (pipResult.status !== 0) {
      console.error('[setup] pip install failed (code ' + pipResult.status + ')');
      exitCode = 1;
    } else {
      console.log('[setup] RAG Python dependencies  ✔');
    }
  } else {
    console.warn('[setup] requirements.txt not found at ' + requirementsFile);
  }
}

// ---- 提示下一步 ----
console.log();
console.log('=================================================');
console.log('[setup] 依赖安装完成。');
console.log('[setup] ');
console.log('[setup] 启动 RAG 服务前，请先启动 PostgreSQL 数据库：');
console.log('[setup]   cd rag-service');
console.log('[setup]   docker compose up -d postgres');
console.log('[setup] ');
console.log('[setup] 首次启动需要导入地图模拟数据：');
console.log('[setup]   Get-Content rag-service/ai-engine/migrations/seed_risk_map_demo.sql ^');
console.log('[setup]     | docker exec -i rag-service-postgres-1 psql -U xiaodun -d xiaodun');
console.log('[setup] ');
console.log('[setup] 然后启动小盾：');
console.log('[setup]   npm start');
console.log('=================================================');

process.exit(exitCode);
