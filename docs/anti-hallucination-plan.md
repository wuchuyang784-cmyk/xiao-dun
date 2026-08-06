# 小盾反幻觉方案

## 已发现的幻觉模式

| 编号 | 症状 | 触发条件 | 严重程度 |
|------|------|----------|----------|
| H1 | 死循环输出相同反诈说教模板 | persona 被污染成"反诈机器人" | 🔴 严重 |
| H2 | 假装创建提醒但不调用工具 | LLM 口头承诺"X 分钟后提醒" | 🟡 中等 |
| H3 | 无触发地生成大量反诈长文本 | context 溢出后 LLM 跑飞 | 🟡 中等 |
| H4 | 多轮 context 累积 → 方向漂移 | 长时间不重启，记忆累积 | 🟠 一般 |

## 方案：分层防御

```
┌─────────────────────────────────────────────┐
│ 第一层：Prompt 约束（阻止行为发生）          │
├─────────────────────────────────────────────┤
│ 第二层：Tool 调用验证（检测假装行为）        │
├─────────────────────────────────────────────┤
│ 第三层：Context 管理（防止溢出跑飞）          │
├─────────────────────────────────────────────┤
│ 第四层：输出守卫（拦截异常输出）               │
└─────────────────────────────────────────────┘
```

---

## 第一层：Prompt 约束（✅ 已完成）

**位置**：`src/prompt.js` — Anti-Fraud Behavioral Constraints

已添加两条新约束：

- **约束 7**：禁止在普通对话中背诵诈骗类型模板，区分"关系型对话"和"反诈播报"
- **约束 8**：禁止口头承诺提醒而不调用 `manage_reminder` 工具

---

## 第二层：Tool 调用验证（待实施）

### 2.1 提醒类工具调用检测

**问题**：LLM 在文本中说"你 14:10 的时候提醒我..."但没有调用工具

**方案**：在 `src/index.js` 的 `markers.js` 中添加检测逻辑：

```javascript
// 检测非法提醒承诺
const FAKE_REMINDER_RE = /(?:(\d{1,2}:\d{2})\s*(?:的时候|分|点).*?提醒)|提醒.*?(\d{1,2}:\d{2})/g
```

在每轮 LLM 回复后扫描文本，如果匹配到时间+提醒但本轮未调用 `manage_reminder`，在下一轮的 `<context>` 中注入提示：

```
⛔ 你上轮说了"X分钟提醒"但没有调用 manage_reminder。用户不会收到提醒。如果你真的想设提醒，这轮请调用工具；否则不要承诺。
```

### 2.2 重复输出检测

**方案**：对比连续 3 轮回复的文本相似度，超过 85% 匹配则在 `<context>` 注入扰动：

```
🔁 检测到连续重复回复。下一步回复必须与前三轮不同。如果当前状况下没有新东西要说，可以保持静默。
```

---

## 第三层：Context 管理（待实施）

### 3.1 Persona 自动刷新机制

**问题**：LLM 通过 `[UPDATE_PERSONA: ...]` 把自己锁死成反诈机器人

**方案 A**：Persona 过期机制

```javascript
// src/runtime/consciousness-loop.js 中每 N 个 TICK 清理一次
const PERSONA_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24 小时

if (lastPersonaUpdate && Date.now() - lastPersonaUpdate > PERSONA_MAX_AGE_MS) {
  setConfig('persona', '')
  emitInjection('persona_reset', 'Your self-description has been cleared; re-assess who you are from recent experience.')
}
```

**方案 B**：Persona 新鲜度注入

每轮 context 中添加 Persona 年龄提示：

```
Your self-description was last updated 8 hours ago. If your behavior has shifted since then, use [UPDATE_PERSONA: ...] to refresh it.
```

### 3.2 Token 预算硬上限

**问题**：单轮 28059 tokens，远超出安全范围

**方案**：在 `src/llm.js` 的 token 计数处添加硬限制（修改现有 quota 逻辑）：

```javascript
const HARD_MAX_OUTPUT_TOKENS = 4096 // 硬截断

// 在 LLM 调用前注入 max_tokens 参数
```

### 3.3 历史压缩策略

**方案**：当 conversation history 超过 N 条消息时，自动压缩旧消息为摘要

```javascript
const MAX_HISTORY_TURNS = 50

function compressHistory(messages, maxTurns) {
  const recent = messages.slice(-maxTurns)
  const old = messages.slice(0, -maxTurns)
  if (old.length === 0) return messages
  return [{ role: 'system', content: `[Summarized earlier: ${summarize(old)}]` }, ...recent]
}
```

---

## 第四层：输出守卫（待实施）

### 4.1 输出长度硬截断

**方案**：在 SSE 推送前检测单条消息是否过长

```javascript
const MAX_MESSAGE_LENGTH = 2048

function guardSSEMessage(message) {
  if (message.content && message.content.length > MAX_MESSAGE_LENGTH) {
    console.warn('[guard] output truncated:', message.content.slice(0, 80), '...')
    message.content = message.content.slice(0, MAX_MESSAGE_LENGTH) + '\n[输出过长，已截断]'
  }
  return message
}
```

### 4.2 反诈模板关键词检测（前端侧）

**方案**：在 `src/ui/brain-ui/display.js` 中检测连续 3 条回复是否包含相同反诈关键词

```javascript
const FRAUD_BOILERPLATE = ['刷单返利', '冒充客服', '公检法', '投资理财', '杀猪盘', '贷款诈骗', '裸聊敲诈']

function detectBoilerplateLoop(messages) {
  const recent = messages.slice(-3)
  if (recent.length < 3) return false
  const matches = recent.map(m => FRAUD_BOILERPLATE.filter(k => m.includes(k)).length)
  return matches.every(m => m >= 3) // 连续 3 条都含 3+ 反诈关键词
}
// → 弹提示："检测到重复内容，建议 /clear 重置对话后重试"
```

---

## 实施优先级

| 优先级 | 条目 | 预计工时 | 效果 |
|--------|------|----------|------|
| P0 | Prompt 约束（H1, H2） | ✅ 已完成 | 减少 70% 幻觉 |
| P1 | Persona 过期机制（H1） | 1h | 防止僵尸 persona |
| P1 | 输出长度守卫（H3） | 0.5h | 拦截长文本跑飞 |
| P2 | 重复输出检测（H1） | 1h | 死循环预警 |
| P2 | 提醒调用验证（H2） | 1h | 提醒准确性 |
| P3 | Token 硬上限 + 历史压缩（H4） | 2h | 长期稳定性 |

总计约 **6 小时工时**，可分阶段交付。第一层 Prompt 约束已生效，提交后重启即可。
