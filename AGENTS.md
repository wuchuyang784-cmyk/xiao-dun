## 项目概述

小盾数据管理后台（XiaoDun Admin Web）——基于浏览器的本地 AI 助手运行时。原 Electron 桌面应用改造为纯 Node 后端 + HTTP API + SSE/WebSocket，前端由浏览器加载。具备 LLM 对话、记忆系统、工具执行、语音识别、嵌入向量、天气/热点采集等能力。

## 技术栈

- **运行时**：Node.js >= 22（ESM 模块）
- **前端**：原生 HTML + JavaScript（无框架），`index.html` → `src/ui/brain-ui/app.js`
- **后端**：Node.js HTTP 服务，支持 SSE 和 WebSocket
- **数据库**：SQLite（better-sqlite3），数据文件 `data/jarvis.db`
- **LLM 集成**：OpenAI SDK，支持多 Provider（DeepSeek、Minimax、通义千问、Kimi、智谱等）
- **语音**：sherpa-onnx-node（本地 ASR/TTS）
- **嵌入**：@huggingface/transformers（本地嵌入模型）
- **可视化**：ECharts
- **包管理**：npm（有 `package-lock.json`）

## 目录结构

```
xiao-dun/
├── index.html              # 前端入口
├── config.json             # 运行时配置（LLM provider、TTS、社交等）
├── src/
│   ├── index.js            # 后端主入口（启动 HTTP API、SSE、WebSocket、主循环）
│   ├── api.js              # HTTP API 路由
│   ├── llm.js              # LLM 调用封装
│   ├── db.js               # SQLite 数据库操作
│   ├── config.js           # 配置加载
│   ├── prompt.js           # System Prompt 构建
│   ├── memory/             # 记忆系统（线程、摘要、注入、刷新循环）
│   ├── capabilities/       # 工具执行与能力市场
│   ├── scene/              # 场景系统
│   ├── ui/                 # 前端 UI（brain-ui）
│   ├── agents/             # Agent 注册与调度
│   ├── skills/             # 技能注册
│   ├── social/             # 社交连接器（飞书等）
│   ├── voice/              # 语音处理
│   ├── providers/          # LLM Provider 实现
│   └── ...
├── scripts/
│   ├── start-web.mjs       # Web 模式启动脚本（拉后端 + 等待就绪）
│   ├── web-runtime.mjs     # Web 运行时配置（端口、host、ready file）
│   ├── coze-preview-build.sh  # 预览构建脚本
│   ├── coze-preview-run.sh    # 预览运行脚本
│   ├── deploy_build.sh        # 部署构建脚本
│   └── deploy_run.sh          # 部署运行脚本
├── data/                   # 数据目录（SQLite DB、配置缓存）
├── docs/                   # 文档
└── public/                 # 静态资源
```

## 关键入口 / 核心模块

- **后端启动**：`scripts/start-web.mjs` → spawn `node src/index.js`
- **前端入口**：`index.html` → `src/ui/brain-ui/app.js`
- **API 层**：`src/api.js`（HTTP 路由、SSE 推送、WebSocket）
- **主循环**：`src/index.js` 中的意识循环（LLM 调用 → 工具执行 → 记忆注入）
- **配置**：`config.json`（LLM provider/TTS/社交）+ `.env`（API 密钥）

## 运行与预览

- **预览启动**：通过 `.coze` 的 `[dev]` 配置，执行 `bash xiao-dun/scripts/coze-preview-run.sh`
- **端口**：从 `.preview` 读取 `expose_port`（默认 5000），通过 `XIAODUN_PORT` 环境变量传入
- **绑定地址**：`0.0.0.0`（通过 `XIAODUN_HOST` 环境变量）
- **部署启动**：通过 `.coze` 的 `[deploy]` 配置，执行 `bash xiao-dun/scripts/deploy_run.sh`，固定端口 5000

## 用户偏好与长期约束

- 包管理器为 npm（项目已有 `package-lock.json`），暂不迁移到 pnpm
- 前端无框架，原生 HTML + JS + CSS

## 常见问题和预防

- 首次启动需联网（拉取嵌入模型、探测 LLM），均可超时跳过不阻塞启动
- 原生模块 `better-sqlite3` 和 `sherpa-onnx-node` 在某些平台可能需要本地编译（需 Python 3 + C++ 工具链）
- 未配置 API 密钥时，后端只启动 API 与激活页，需打开 `/activation` 页面手动激活
