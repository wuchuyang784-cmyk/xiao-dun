import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tsconfig = path.join(root, 'tsconfig.json')
const tsc = path.join(root, 'node_modules', 'typescript', 'bin', 'tsc')

if (!fs.existsSync(tsconfig)) {
  throw new Error('tsconfig.json is required for type checking')
}
if (!fs.existsSync(tsc)) {
  throw new Error('TypeScript is not installed. Run npm ci before typecheck.')
}

const result = spawnSync(process.execPath, [tsc, '--project', tsconfig, '--noEmit'], {
  cwd: root,
  stdio: 'inherit',
})
if (result.error) throw result.error
process.exit(result.status ?? 1)
