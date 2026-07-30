import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoots = [path.join(root, 'src'), path.join(root, 'scripts')]
const ignored = new Set(['node_modules', 'build', 'legacy-desktop', 'vendor', '.vite'])
const files = []
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) files.push(full)
  }
}
for (const dir of sourceRoots) if (fs.existsSync(dir)) walk(dir)
const failures = []
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8')
  if (/[ \t]+$/m.test(source)) failures.push(`${path.relative(root, file)}: trailing whitespace`)
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' })
  if (result.status !== 0) failures.push(`${path.relative(root, file)}: syntax error\n${result.stderr}`)
}
if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`Format/syntax checks passed for ${files.length} JavaScript files`)
