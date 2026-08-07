# 备案中心设计（反诈分析记录统一落库 + 独立面板）

## 目标

把小盾的三类诈骗分析统一做成“每次必有备案”：
- 图片诈骗分析
- 短信 / 聊天文本分析
- 链接检测

所有成功分析都写入现有 SQLite 的 `analysis_records` 表；即使分析结果部分失败，也要留下失败备案。用户可以随时打开独立面板查看、筛选和检索自己的备案记录。

## 现状

项目里已经存在：
- `analysis_records` 表
- `analysis-record-service`
- `/records` 路由
- `analyze_fraud_image` 已写入记录

但目前三类分析还没有统一约束，短信 / 链接类记录并未保证“每次都有备案”，前端也没有一个像热点面板一样的独立查看入口。

## 设计原则

1. **不新建表**：继续使用 `analysis_records`
2. **每次必记**：分析一旦开始，就必须产出备案
3. **统一字段**：三种分析都落同一结构，便于检索和统计
4. **记录可回看**：用户可查看摘要、完整报告、来源和时间
5. **独立面板**：像热点一样可打开、刷新、筛选

## 数据模型

在现有 `analysis_records` 上补字段，保留兼容：
- `analysis_kind`：`image | sms | link`
- `subject_kind`：`image | text | url`
- `subject_ref`：图片路径 / URL / 消息引用
- `tool_name`：`analyze_fraud_image | check_sms | check_link`
- `analysis_status`：`done | partial | failed`
- `failure_reason`：失败原因或降级说明
- `report_markdown`：完整分析报告

保留现有字段：
- `record_id`
- `input_summary`
- `input_hash`
- `fraud_type`
- `risk_level`
- `rules_hit`
- `model_used`
- `latency_ms`
- `alert_sent`
- `feedback`
- `source`
- `created_at`

### 索引

新增索引建议覆盖：
- `analysis_kind`
- `subject_kind`
- `tool_name`
- `analysis_status`
- `created_at`
- `risk_level`
- `input_hash`

## 写入规则

三类工具都要走统一备案写入：
- `analyze_fraud_image`
- `check_sms`
- `check_link`

写入时机：
1. 先完成分析
2. 生成统一备案对象
3. 写入 `analysis_records`
4. 返回分析结果 + `record_id`

### 强约束

- 只要工具成功产出分析结果，就必须有一条记录
- 如果分析链路部分降级，仍然写 `analysis_status=partial`
- 如果工具整体失败但已接收到请求，也写 `analysis_status=failed`
- 如果数据库写入失败，工具不能假装成功，必须显式报错并保留失败上下文

## 检索 API

继续复用现有 `/records` 路由，扩展为备案查询入口：

- `GET /records`
  - 支持分页
  - 支持 `analysisKind`
  - 支持 `riskLevel`
  - 支持 `toolName`
  - 支持 `subjectKind`
  - 支持 `keyword`
  - 支持 `dateFrom` / `dateTo`
- `GET /records/stats`
  - 返回总量、今日新增、高风险、按类型统计
- `GET /records/:recordId`
  - 返回单条备案详情

兼容原则：旧参数不删，新参数优先用于备案中心。

## 独立面板

做一个独立的“备案中心”面板，交互风格对齐热点面板：
- 顶部统计卡：总数、今日、高风险、图片 / 短信 / 链接占比
- 筛选区：类型、风险等级、时间范围、关键词
- 列表区：最近备案按时间倒序展示
- 详情区：显示摘要、完整报告、来源工具、分析状态、时间
- 刷新机制：打开时拉取数据；新备案写入后自动刷新

### 入口

建议保留两个入口：
- 独立面板按钮
- `/records` 命令

这样既适合常用查看，也适合临时快速打开。

## 事件和刷新

分析工具写入成功后，发出统一事件：
- `analysis_record_created`

UI 监听该事件：
- 如果备案面板已打开，刷新列表和统计
- 如果面板未打开，可只更新一个轻量提示，不打断当前对话

## 失败处理

1. 分析工具失败时仍尽量落失败备案
2. 写库失败要返回明确错误
3. 面板读取失败时显示空态 + 重试按钮
4. 不允许 silent fail

## 测试

至少覆盖：
- 图片分析、短信分析、链接检测都会写记录
- 失败 / 降级仍会写失败备案
- `/records` 能按类型、风险、时间、关键词过滤
- `record_id` 可查详情
- 面板打开后能刷新到新记录

## 验收标准

- 每一次诈骗分析都有 SQLite 备案
- 用户能在独立面板查看自己的备案历史
- 能按类型和风险快速检索
- 不影响现有 RAG 检索和反诈分析逻辑
