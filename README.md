# 小盾数据管理后台（XiaoDun Admin Web）

本目录是 **小盾（XiaoDun/Jarvis）** 的运行版本：用浏览器访问的本地 AI 助手运行时。
原有桌面窗口（Electron）的运行方式被保留为纯 Node 后端 + HTTP API + SSE/WebSocket，前端页面仍由浏览器加载。

```text
浏览器 ── http://127.0.0.1:3721/ ──> Node HTTP API + SSE + WebSocket
                                      └─ 主循环（LLM / 记忆 / 工具执行）
```

- `index.html` 加载 `src/ui/brain-ui/app.js` 与样式。
- `src/index.js` 启动后端、HTTP API、SSE、WebSocket、主循环。
- `scripts/start-web.mjs` 负责拉起后端子进程、等待网页就绪、并自动打开浏览器（Web 模式）。

---

## 1. 环境要求

| 项目 | 要求 |
| --- | --- |
| Node.js | **>= 22**（ESM，`package.json` 已声明 `engines.node >=22`） |
| 操作系统 | Windows / macOS / Linux（x64 提供预编译原生模块） |
| 联网 | 首次启动需联网：拉取嵌入模型、探测/调用 LLM、天气/热点采集（均可超时跳过，不阻塞启动） |
| 构建 | **无需构建步骤**，直接 `node` 运行源码 |

> 依赖中包含原生模块：`better-sqlite3`（优先用预编译包，缺失时回退 `node-gyp` 编译）、`sherpa-onnx-node`（Windows x64 已提供预编译 `sherpa-onnx-win-x64`）。
> 在缺少预编译包的平台（如某些 Linux 发行版/arm64）首次 `npm install` 可能触发本地编译，需要 Python 3 与 C/C++ 工具链。

---

## 2. 安装

```bash
# 仓库根目录
npm install
```

`npm install` 会安装依赖并处理原生模块。安装完成后即可启动，无需打包或编译前端。

---

## 3. 配置（启动前）

### 3.1 环境变量

所有变量均为可选，未设置时使用默认值。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `XIAODUN_PORT` | `3721` | 监听端口 |
| `XIAODUN_HOST` | `127.0.0.1` | 绑定地址；设为 `0.0.0.0` 可监听所有网卡 |
| `XIAODUN_NO_OPEN` | 未设置 | 设为 `1`/`true` 时**不自动打开浏览器** |
| `XIAODUN_WEB_ONLY` | 未设置 | 设为 `1`/`true` 时跳过桌面 TUI（仅跑后端+网页） |
| `XIAODUN_ALLOW_LAN` | 未设置 | 设为 `1`/`true` 时允许局域网访问（等价于配置里 `network.allowLanAccess`） |
| `XIAODUN_USER_DIR` | 仓库根目录 | 用户数据目录（DB / 沙盒 / 配置），**部署时建议指向持久化盘** |
| `XIAODUN_RESOURCES_DIR` | 仓库根目录 | 只读资源目录（HTML / UI 资源） |

### 3.2 `.env` 文件（API 密钥）

启动脚本通过 `node --env-file-if-exists=.env` 加载 `.env`，文件不存在也不会报错。
可在 `.env` 中放入 LLM 密钥，启动后自动完成激活（见 3.3），无需打开激活页。

```ini
# .env 示例
DEEPSEEK_API_KEY=sk-xxxx
# 可选：指定模型（缺省走该 provider 默认模型）
# DEEPSEEK_MODEL=deepseek-v4-pro

# 其它可选 provider（任一可触发自动激活）
# MINIMAX_API_KEY=xxx
# OPENAI_API_KEY=sk-xxx
# DASHSCOPE_API_KEY=xxx      # 阿里云百炼 / 通义千问
# MOONSHOT_API_KEY=xxx       # Kimi
# ZHIPU_API_KEY=xxx          # 智谱 GLM
# MIMO_API_KEY=xxx           # 小米 MiMo
```

> 首次运行、且 `.env` 与 `config.json` 均未配置任何密钥时，后端只会启动 API 与激活页，主循环不运行；需打开 `/activation` 页面手动激活后才能对话。

### 3.3 支持的 LLM Provider

| Provider | 环境变量 | 默认模型 |
| --- | --- | --- |
| DeepSeek | `DEEPSEEK_API_KEY` | `deepseek-v4-pro` |
| MiniMax | `MINIMAX_API_KEY` | `MiniMax-M2.7` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5.5` |
| 通义千问 Qwen | `DASHSCOPE_API_KEY` | `qwen-turbo` |
| Kimi / Moonshot | `MOONSHOT_API_KEY` | `kimi-k2.6` |
| 智谱 GLM | `ZHIPU_API_KEY` | `glm-5.1` |
| 小米 MiMo | `MIMO_API_KEY` | `mimo-v2.5-pro` |
| Custom Endpoint | —（激活页填写） | 自定义 `baseURL` + 模型名 |

设置任一密钥后，启动会自动探测并激活对应 provider；也可在网页 `/activation` 页面填写（支持自动识别 provider）。

---

## 4. 启动

### 4.1 Web 模式（推荐，本仓库默认方式）

```bash
npm start
# 等价：npm run dev / node scripts/start-web.mjs
```

- 自动拉起后端子进程（已设 `XIAODUN_WEB_ONLY=1`，不跑桌面 TUI）。
- 等待网页就绪后，自动打开浏览器访问 `http://127.0.0.1:3721/`。
- 若不想自动打开浏览器：`XIAODUN_NO_OPEN=1 npm start`。
- 换端口（同时改后端与浏览器地址）：`XIAODUN_PORT=3722 npm start`。

### 4.2 仅启动后端（无桌面 TUI）

```bash
# 直接运行后端（默认仍会尝试启动 TUI，除非设 XIAODUN_WEB_ONLY=1）
npm run start:backend

# 无头/服务器场景：只跑后端+网页，不启动 TUI
XIAODUN_WEB_ONLY=1 node --env-file-if-exists=.env src/index.js
```

### 4.3 局域网 / 无头部署（服务器）

```bash
# 监听所有网卡，允许局域网访问
XIAODUN_HOST=0.0.0.0 \
XIAODUN_ALLOW_LAN=1 \
XIAODUN_WEB_ONLY=1 \
XIAODUN_NO_OPEN=1 \
node --env-file-if-exists=.env src/index.js
```

Windows PowerShell 可用 `scripts/start-lan.ps1` 一键开启局域网模式（自动扫描私有网段 IP 并打印访问地址）：

```powershell
pwsh -File scripts/start-lan.ps1          # 默认 mode=app
pwsh -File scripts/start-lan.ps1 -Mode backend
```

> ⚠️ **安全警告**：绑定 `0.0.0.0` 后，同一网络内的任何设备都能访问本服务。小盾具有**写文件、执行命令、发消息**等高风险工具能力，**切勿直接暴露到公网**。生产环境务必放在反向代理（Nginx/Caddy）之后并加鉴权（Basic Auth / 带 Token 的网关），或用 VPN/SSH 隧道访问。

### 4.4 首次激活

1. 浏览器打开 `http://<host>:<port>/`（或 `/activation`）。
2. 输入 LLM API Key，选择 Provider 与模型，点击激活。
3. 激活成功后主循环启动，即可对话。
4. 若已在 `.env` 配置了密钥，启动即自动激活，可跳过此步。

---

## 5. 数据与持久化

默认所有数据落在 **仓库根目录**（开发模式），部署时建议用 `XIAODUN_USER_DIR` 指向持久化目录并备份：

| 路径（相对 `XIAODUN_USER_DIR`） | 内容 |
| --- | --- |
| `data/jarvis.db` | SQLite 主数据库（记忆、对话、线索、配置键值） |
| `data/media/` | 聊天媒体内容寻址副本 |
| `data/models/` | 本地嵌入模型缓存（首次用到本地召回时下载约 **330MB** ONNX 模型） |
| `config.json` | 通用配置（provider 指针、温度、安全、网络、社交/ClawBot 凭据） |
| `llm/<provider>.json` | 各 LLM provider 的密钥与模型 |
| `voice/<provider>.json` | 语音 ASR provider 的密钥 |
| `sandbox/` | Agent 工作沙盒（笔记、下载、音频、文章、技能等） |

**升级建议**：保留上述 `data/`、`config.json`、`llm/`、`voice/`、`sandbox/` 目录，仅替换代码，配置与记忆不会丢失。首次启动会自动做 config schema 迁移与沙盒种子拷贝。

> ⚠️ **密钥提醒**：仓库内现有 `config.json` 已明文存放部分凭据（如 TTS key、ClawBot token）。正式部署应避免把密钥提交进版本库；尽量用 `.env` / `XIAODUN_USER_DIR` 外置数据目录管理，并加入 `.gitignore`。

---

## 6. 生产部署建议

### 6.1 进程守护（不阻塞前台）

直接用 `node` 启动是前台进程，断开终端即退出。服务器部署请用进程管理器：

- **pm2**：
  ```bash
  XIAODUN_HOST=0.0.0.0 XIAODUN_ALLOW_LAN=1 XIAODUN_WEB_ONLY=1 XIAODUN_NO_OPEN=1 \
    pm2 start "node --env-file-if-exists=.env src/index.js" --name xiaodun
  pm2 save && pm2 startup
  ```
- **systemd**（示例 `/etc/systemd/system/xiaodun.service`）：
  ```ini
  [Unit]
  Description=XiaoDun Admin Web
  After=network.target

  [Service]
  Type=simple
  User=xiaodun
  WorkingDirectory=/opt/xiaodun
  Environment=XIAODUN_HOST=0.0.0.0
  Environment=XIAODUN_ALLOW_LAN=1
  Environment=XIAODUN_WEB_ONLY=1
  Environment=XIAODUN_NO_OPEN=1
  Environment=XIAODUN_USER_DIR=/var/lib/xiaodun
  ExecStart=/usr/bin/node --env-file-if-exists=.env /opt/xiaodun/src/index.js
  Restart=on-failure
  RestartSec=5

  [Install]
  WantedBy=multi-user.target
  ```
  启用：`systemctl daemon-reload && systemctl enable --now xiaodun`

### 6.2 反向代理（公网/域名访问）

仅暴露 3721 端口，反向代理到内网地址并加鉴权与 TLS：

```nginx
server {
    listen 443 ssl;
    server_name xiaodun.example.com;

    ssl_certificate     /etc/nginx/ssl/xiaodun.crt;
    ssl_certificate_key /etc/nginx/ssl/xiaodun.key;

    # 简单鉴权（生产建议用更完善的 SSO/网关）
    auth_basic "XiaoDun";
    auth_basic_user_file /etc/nginx/xiaodun.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:3721;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;     # WebSocket/SSE
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

### 6.3 可选：Docker 部署

项目未内置 Dockerfile，最小可用配置如下（放在仓库根目录 `Dockerfile`）：

```dockerfile
FROM node:22-bookworm-slim
WORKDIR /app
# 编译原生模块可能需要：apt-get update && apt-get install -y python3 make g++
COPY package.json package-lock.json ./
RUN npm install --omit=dev
COPY . .
ENV XIAODUN_HOST=0.0.0.0 \
    XIAODUN_WEB_ONLY=1 \
    XIAODUN_NO_OPEN=1 \
    XIAODUN_USER_DIR=/data
VOLUME ["/data"]
EXPOSE 3721
CMD ["node", "--env-file-if-exists=/app/.env", "src/index.js"]
```

构建运行（密钥通过 `--env-file` 或挂载的 `.env` 注入，数据挂到卷）：

```bash
docker build -t xiaodun .
docker run -d -p 3721:3721 \
  -v $(pwd)/.env:/app/.env \
  -v xiaodun-data:/data \
  --name xiaodun xiaodun
```

---

## 7. 脚本与命令速查

| 命令 | 作用 |
| --- | --- |
| `npm start` / `npm run dev` | Web 模式启动（拉起后端 + 自动开浏览器） |
| `npm run start:backend` | 仅后端（`--env-file-if-exists=.env src/index.js`） |
| `npm run lint` | 语法检查几个核心脚本 |
| `npm run build` | lint + 格式检查 + 类型检查（不产出可分发包） |
| `npm run smoke:brain-ui` | Brain UI 冒烟测试（Playwright） |
| `scripts/start-lan.ps1` | Windows 一键局域网模式 |

---

## 8. 故障排查

- **端口被占用**：设置 `XIAODUN_PORT` 换个端口，或释放 3721。
- **启动后页面打不开**：确认后端进程在跑；检查 `XIAODUN_HOST` 是否绑定到正确网卡；局域网场景需 `XIAODUN_ALLOW_LAN=1` 并放行防火墙（私有网络）。
- **提示未激活 / 不对话**：打开 `/activation` 配置密钥，或确认 `.env` 里密钥正确且已加载；激活状态写入 `config.json` / `llm/*.json`。
- **原生模块安装失败**：检查 Node 版本（>=22）；非预编译平台安装 `python3`、C/C++ 编译工具链后重跑 `npm install`；`better-sqlite3` 会回退 `node-gyp rebuild`。
- **首次本地召回慢**：首次用到本地嵌入会下载约 330MB ONNX 模型到 `data/models/`，之后离线可用；下载失败会退化为 FTS5 全文检索，不影响启动。
- **Windows 上 `npm start` 不自动开浏览器**：确认未设 `XIAODUN_NO_OPEN=1`；也可手动访问 `http://127.0.0.1:3721/`。

---

## 9. 说明

本次从桌面运行时转换为网页运行版，**未新增前端页面、未重做 UI**。后续业务内容、地图与异常检测面板应在现有 Brain UI 结构（`src/ui/brain-ui/`）上迭代。
