# dev 合并 dev2 后的测试验证报告

日期：2026-08-01
合并提交：`06fa984`（本地 dev，领先 origin/dev 4 个提交，尚未推送）

## 一、合并目标（用户要求）
- 保留 dev2 的 RAG 能力
- 保留 dev 的前端执行规划面板调整
- 融合 prompt.js 的反诈规划协议与文案

## 二、通过的验证项

| 验证项 | 命令/方式 | 结果 |
|---|---|---|
| 主测试套件 | `npm test` | **11/11 通过**（含 RAG 能力、fraud-capability、rag-route 等用例） |
| 语法检查 | `node --check app-shell.js / app.js / prompt.js` | 全部 OK |
| 类型检查 | `npm run typecheck` | OK |
| Lint | `npm run lint` | OK |
| RAG 能力保留 | 检查 `rag-service/`、`src/db/stores/*`、`executor.js`、`tool-policy.js`、`capability-registry.js` | 自动合并成功，`rag-client.js` 仍存在 |
| 前端规划保留 | 检查 `prompt.js`、`styles.css` | 反诈规划协议融合保留；`.plan-card`/`.tick-stream` 规划面板样式保留 |
| 浏览器 E2E（忠实复现冒烟逻辑） | 独立 Playwright 诊断 | 地图渲染可见、SSE 实时回复（live+jarvis）正常、热点面板 PANEL_OK 触发、无任何 pageerror/console error |

## 三、冒烟脚本（smoke:brain-ui）失败分析 —— 均与合并无关

冒烟脚本失败在两处，经深入排查**均非合并引入的回归**：

### 1. 加载时序脆弱（热点用例 411 超时）
- 根因：脚本用 `waitUntil: 'domcontentloaded'` + `map-stage` 等待 5s，在 ESM 模块尚未完全初始化（onUserMessage 未注册）时就 fill+click，导致热点未触发。
- 验证：改为 `waitUntil: 'load'` + 15s 后复跑，**热点面板 `PANEL_OK` 正常触发**。
- 结论：纯测试脚本脆弱性，非代码问题。建议把 `scripts/smoke-brain-ui.mjs:367-368` 的等待策略放宽。

### 2. 世界杯面板用例超时
- 根因：app.js 的 `onUserMessage` 正则仅匹配 热点/热搜/新闻/趋势，**从未包含"世界杯"**；代码中也不存在 `toggleWorldcup` / `setWorldcupMode` / `worldcup-mode` 的设置函数。
- 验证：经 `git grep` 确认，合并前旧 dev（`2ed189a`）与 dev2（`origin/dev2`）的 `app.js`/`chat.js` **都没有 worldcup 触发逻辑**，也无 `worldcup.js`。
- 结论：该功能是"测试期望超前于实现"，合并前就不通过，**非合并破坏**。

## 四、最终结论
合并成功，核心目标全部达成且无回归：
- ✅ dev2 的 RAG 能力完整保留
- ✅ dev 的前端执行规划面板完整保留
- ✅ prompt.js 反诈规划协议与文案已融合
- ✅ 合并后 brain-ui 核心功能（地图、SSE 实时回复、热点面板）经浏览器实测正常，无 JS 错误

冒烟脚本的失败是脚本自身的两处问题（加载等待过紧 + worldcup 功能未实现），与本次合并无关。

## 五、后续建议（可选）
1. 放宽冒烟脚本的加载等待策略，消除脆弱性，使其能正确反映合并状态。
2. 如希望 worldcup 面板可用，需在 app.js 的 `onUserMessage` 增加世界杯命令分支（与本次合并无关的独立需求）。
3. 验证通过后，可将合并提交 `git push origin dev`。
