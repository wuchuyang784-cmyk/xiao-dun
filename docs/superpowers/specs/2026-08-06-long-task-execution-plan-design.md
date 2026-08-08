# 通用长任务执行规划设计

日期：2026-08-06  
状态：已确认，待实现

## 1. 背景与问题

右侧“执行规划”面板当前把工具调用事件直接映射成步骤。`plan-state.js` 在收到工具事件但没有真实任务步骤时，会自动补一条“执行工具”，因此出现固定的 `0 / 1`、`1 / 1`，并且用户看到的是工具结果，不是任务计划。

图片诈骗分析暴露了这个问题：`analyze_fraud_image` 实际包含视觉识别、文字/实体提取、规则筛查、外部 RAG 检索和报告汇总多个阶段，但当前面板只显示一个复合工具。

## 2. 目标

1. 任何多步任务或长任务工具调用都展示真实、可解释的阶段步骤。
2. 工具调用只作为步骤下的执行证据，不再被伪装成业务步骤。
3. 进度显示真实的 `n / total`，不再生成虚假的 `0 / 1`。
4. 没有活动任务时，规划区显示“等待指令”。
5. 计划生成前、计划缺失、步骤失败等状态都能被用户区分。
6. 兼容现有 `set_task(steps[])`、`task_step_updated` 和 `task_cleared` 流程。

## 3. 非目标

- 不把所有普通短消息都强制生成任务计划。
- 不让前端根据工具名称猜测完整业务流程。
- 不依赖 LLM 每次都主动调用 `set_task` 才能展示长任务进度。
- 不改变 SQLite 的记忆、对话、状态和审计职责。

## 4. 核心设计

### 4.1 计划的两个来源

#### A. Agent 显式计划

Agent 调用 `set_task(description, steps[])` 时，后端原样建立任务计划并发送 `task_set` 事件。每个步骤必须是具体、按顺序、可验证的动作。

#### B. 长任务工具的后端计划

工具注册信息增加长任务计划元数据。工具开始执行前，后端根据工具元数据创建计划并发送 `task_set`，不要求 Agent 额外调用 `set_task`。

专用计划示例：

```js
{
  tool: 'analyze_fraud_image',
  longTaskPlan: {
    title: '图片诈骗分析',
    steps: [
      { id: 'vision', text: '识别图片内容' },
      { id: 'extract', text: '提取文字与实体' },
      { id: 'rules', text: '规则引擎筛查' },
      { id: 'rag', text: '外部 RAG 检索相似案例' },
      { id: 'report', text: '汇总风险分析报告' }
    ]
  }
}
```

首批接入专用或通用长任务计划的工具：

- `analyze_fraud_image`
- `run_api_capability`
- `delegate_to_agent`
- `exec_task_command`
- `browser_read`
- `fetch_url`
- `web_search`

没有专用阶段定义的长任务工具使用统一生命周期计划：

1. 准备输入
2. 执行任务
3. 校验结果
4. 整理输出

后续新增长任务工具必须声明 `longTaskPlan` 或明确使用通用生命周期计划。

### 4.2 长任务判定

优先级如下：

1. 当前回合已有显式 `set_task`：使用显式计划。
2. 工具声明了 `longTaskPlan`：使用工具专用计划。
3. 工具声明 `longTask: true` 但没有专用步骤：使用通用生命周期计划。
4. 普通工具没有计划元数据：不自动创建任务步骤。

不使用“执行超过几秒就猜测成多步任务”的方式作为主判定依据，避免计划在工具执行中途突然跳变。耗时统计只用于显示时间和诊断。

### 4.3 事件协议

保留现有事件名，并扩展字段：

```js
task_set: {
  task,
  plan_id,
  source: 'agent' | 'tool',
  tool_name?,
  steps: [
    { id, text, status: 'pending' }
  ]
}

task_step_updated: {
  plan_id?,
  step_id?,
  index?,
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped',
  note?,
  progress: '2/5',
  tool_name?
}

tool_preparing / tool_executing / tool_call: {
  name,
  plan_id?,
  plan_step_id?,
  ok?,
  duration_ms?
}
```

`step_id` 是首选定位字段，`index` 作为兼容现有前端和旧事件的回退字段。

### 4.4 复合工具阶段回调

复合工具通过执行上下文接收一个可选的阶段回调，例如：

```js
context.onTaskProgress?.({
  stepId: 'vision',
  status: 'running',
  note: '正在调用视觉模型识别图片'
})
```

`analyze_fraud_image` 使用该回调推进五个真实阶段。阶段完成时写入关键结论，例如识别出的图片类型、规则命中数量、RAG 案例数量，而不是只写“完成”。

### 4.5 无任务与缺计划状态

前端状态机调整为：

- 初始状态：`idle`，显示“等待指令”。
- 收到普通 `message_received`：仍显示“等待指令”，不创建空计划。
- 收到 `task_set`：进入 `active`，渲染真实步骤。
- 收到长任务工具事件但后端尚未发送计划：不创建“执行工具”步骤；显示“正在生成执行计划”或暂不改变规划区。
- 收到没有计划元数据的工具调用：规划区显示“该工具未提供阶段计划”，但不显示 `0 / 1`。
- 收到 `task_cleared`：进入 `complete`，保留已完成计划直到下一条新用户任务。
- 下一条 `message_received`：清空旧计划并回到“等待指令”。

## 5. 前端 A 布局

右侧规划卡片采用分阶段流程：

1. 标题和整体进度，例如 `图片诈骗分析 · 2 / 5`。
2. 每个阶段显示状态、阶段耗时和关键 note。
3. 阶段内部显示工具 chip，包含工具名、状态和执行耗时。
4. 当前阶段高亮，已完成阶段使用完成态，未开始阶段保持等待态。
5. 失败阶段显示失败原因，并保留前面阶段的证据。

`plan-state.js` 不再在 `appendTool()` 中创建隐式“执行工具”步骤。工具事件只能：

- 绑定到已有 `plan_step_id`；
- 或在没有任务计划时记录为无计划工具活动，不改变步骤总数。

## 6. 数据流

```text
用户消息
  → Agent 判断
  → set_task 或长任务工具元数据
  → 后端创建 task_set
  → 工具执行前/执行中发送 tool_* 与 task_step_updated
  → 前端 plan-state.js 更新
  → A 布局渲染阶段、工具证据和真实进度
```

对于 `analyze_fraud_image`：

```text
task_set(5 steps)
  → vision running / analyze_image
  → extract running / OCR + entity extraction
  → rules running / fraud rule screening
  → rag running / external RAG retrieval
  → report running / report assembly
  → task_cleared
```

## 7. 错误处理

- 阶段失败：标记对应步骤 `failed`，写入错误 note，保留已完成步骤。
- 工具失败但任务可换方案：步骤保持 `running` 或转 `failed`，由 Agent 决定重规划。
- 任务被新消息打断：发送 `processing_preempted`，当前阶段标记为中断。
- 后端没有阶段计划：不伪造步骤，不伪造进度。

## 8. 测试计划

### 状态机单测

1. `message_received` 后没有任务时显示 idle/等待指令。
2. 无计划的 `tool_call` 不会生成“执行工具”步骤。
3. `task_set` 的五个阶段显示 `0 / 5`。
4. 阶段更新后进度正确变为 `1 / 5`、`2 / 5`。
5. 工具事件绑定到指定 `plan_step_id`，不会挂到错误阶段。
6. `task_cleared` 后保留完整计划并显示完成。

### 后端/协议单测

1. 显式 `set_task` 优先于工具自动计划。
2. 长任务工具开始前发送 `task_set`。
3. 未声明长任务的普通工具不会自动创建计划。
4. `analyze_fraud_image` 的五个阶段按执行顺序发出状态更新。
5. 计划阶段 note 包含真实结果摘要。

### 验收标准

- 普通聊天打开面板显示“等待指令”。
- 图片诈骗分析至少显示五个阶段，不再出现 `0 / 1`。
- 任意已登记长任务工具都能显示阶段计划。
- 没有计划的工具调用不会污染任务进度。
- 全量测试、构建、格式检查和类型检查通过。

