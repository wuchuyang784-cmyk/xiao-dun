import { createHotspotPanel } from './hotspot-panel.js';
import { createDocPanel } from './doc-panel.js';
import { createRagManagerPanel } from './rag-manager-panel.js';

const createMapStage = () => `
<div class="grid-overlay"></div>
<div id="map-stage" class="map-stage" aria-label="China fraud case map">
  <div id="fraud-map-chart" class="fraud-map-chart" aria-label="\u4e2d\u56fd\u7701\u7ea7\u8bc8\u9a97\u6848\u4f8b\u70ed\u529b\u56fe"></div>
  <div class="fraud-map-empty" id="fraud-map-empty" hidden>\u7b49\u5f85\u4e2d\u56fd\u7701\u7ea7\u5730\u56fe\u6570\u636e</div>
</div>
`;

const createPrimaryPanel = () => `
<aside id="panel-l1" class="panel">
  <header class="panel-identity">
    <div class="brand-mark"></div>
    <div class="brand-copy">
      <div class="eyebrow">认知界面</div>
            <div class="brand-title" id="agent-brand-name">小盾 AI Agent</div>
    </div>
    <button class="voice-btn" id="voice-btn" title="麦克风 开/关" type="button">🎤</button>
    <button class="video-btn" id="video-btn" title="视频模式 (V)" type="button" hidden>⊞</button>
    <button class="settings-btn" id="settings-btn" title="设置" type="button">⚙</button>
  </header>

  <div class="stream-meta">
    <div>
      <div class="stream-title-text">用户消息处理器</div>
      <!-- <div class="stream-subtitle">user message · react</div> -->
    </div>
    <span class="pill" id="pill-l1">实时</span>
  </div>

  <!-- AI 当前正在做什么：纯派生展示，从 tool_call 事件流自动归类，AI 不需要做任何额外动作。
       北极星：通信问题靠界面侧派生可视化解决，不逼 AI 学人开口。 -->
  <div class="ai-activity" id="ai-activity">
    <span class="ai-activity-dot" id="ai-activity-dot"></span>
    <span class="ai-activity-label" id="ai-activity-label">空闲</span>
    <span class="ai-activity-detail" id="ai-activity-detail"></span>
  </div>

  ${createVoicePanel()}

  <div class="legend" id="legend"></div>

  <div class="stream">
    <div class="stream-inner" id="si-l1"></div>
  </div>

</aside>
`;

const createSecondaryPanel = () => `
<aside id="panel-l2" class="panel">
  <header class="panel-stats">
    <div class="stat">
      <span class="stat-label">状态</span>
      <div class="stat-value live" id="conn-state"><span class="live-dot"></span>Token流</div>
    </div>
    <div class="stat">
      <span class="stat-label">模型</span>
      <div class="stat-value" id="llm-provider-name">—</div>
    </div>
    <div class="stat">
      <span class="stat-label">运行</span>
      <div class="stat-value" id="uptime">0h 0m</div>
    </div>
    <div class="stat">
      <span class="stat-label">tok/s</span>
      <div class="stat-value" id="tok-rate">—</div>
    </div>
    <div class="stat" id="mem-recall-stat" title="近 1 小时记忆召回次数 / 平均拉取条数。点击查看明细">
      <span class="stat-label">召回/h</span>
      <div class="stat-value" id="mem-recall-rate">—</div>
    </div>
    <div class="stat" id="mem-extract-stat" title="近 1 小时记忆抽取次数 / 平均写入条数。点击查看明细">
      <span class="stat-label">抽取/h</span>
      <div class="stat-value" id="mem-extract-rate">—</div>
    </div>
    <div class="stat" id="ctx-stat" title="LLM 上下文估算 token 数。超过 16000 建议 /compress。点击压缩">
      <span class="stat-label">上下文</span>
      <div class="stat-value" id="ctx-token-count">—</div>
    </div>
  </header>

  <div class="stream-meta">
    <div>
      <div class="stream-title-text">执行规划</div>
      <div class="stream-subtitle">工具链 · 步骤</div>
    </div>
    <span class="pill" id="pill-l2">等待指令</span>
  </div>

  <div id="plan-list"></div>

  <div class="tick-stream" id="tick-stream">
    <div class="stream">
      <div class="stream-inner" id="si-l2"></div>
    </div>
  </div>
</aside>
`;

const createConsole = () => `
<section class="console" id="chat-area">
  <div id="chat-history">
    <div id="chat-messages"></div>
  </div>
  <div id="paste-attachments" class="paste-attachments" hidden></div>
  <div id="input-row">
    <div id="slash-menu" class="slash-menu" role="listbox" aria-label="命令" hidden></div>
    <span class="prompt-mark">▸</span>
    <textarea id="msg-input" rows="1" placeholder="向小盾发送消息…（输入 / 调出命令，Shift+Enter 换行）" autocomplete="off"></textarea>
    <button id="send-btn" type="button">发送</button>
  </div>
</section>
`;

const createThemeSwitcher = () => `
<div class="theme-switcher" id="theme-switcher">
  <div class="theme-dot active" data-t="midnight" title="Midnight Steel"></div>
  <div class="theme-dot" data-t="phosphor" title="Phosphor CRT"></div>
  <div class="theme-dot" data-t="violet" title="Violet Lab"></div>
  <div class="theme-dot" data-t="rose" title="Rose Dusk"></div>
  <div class="theme-dot" data-t="arctic" title="Arctic"></div>
  <div class="theme-dot" data-t="sand" title="Warm Sand"></div>
</div>
`;

const createTooltip = () => `
<div id="tip"></div>
`;

const createSettingsModal = () => `
<div class="settings-overlay" id="settings-overlay" hidden>
  <div class="settings-modal" role="dialog" aria-modal="true" aria-label="设置">
    <div class="settings-header">
      <span class="settings-title">设置</span>
      <button class="settings-close" id="settings-close" type="button" aria-label="关闭">×</button>
    </div>
    <div class="settings-body">

      <!-- 侧栏导航 -->
      <nav class="settings-nav">
        <button class="settings-nav-item active" data-tab="appearance" type="button">外观</button>
        <button class="settings-nav-item" data-tab="llm" type="button">LLM 模型</button>
        <button class="settings-nav-item" data-tab="media" type="button">媒体能力</button>
        <button class="settings-nav-item" data-tab="social" type="button">社交媒体</button>
        <button class="settings-nav-item" data-tab="voice" type="button">语音对话</button>
        <button class="settings-nav-item" data-tab="web-search" type="button">上网搜索</button>
        <button class="settings-nav-item" data-tab="security" type="button">安全沙箱</button>
        <button class="settings-nav-item" data-tab="advanced" type="button">高级功能</button>
      </nav>

      <!-- 内容区 -->
      <div class="settings-content">

        <!-- ── 外观 tab ── -->
        <div class="settings-tab active" data-tab="appearance">
          <div class="settings-section">
            <div class="settings-section-label">主题</div>
            ${createThemeSwitcher()}
          </div>
          <div class="settings-section">
            <div class="settings-section-label">AI 名字</div>
            <div class="settings-row">
              <label class="settings-label" for="settings-agent-name">显示名</label>
              <input class="settings-input" id="settings-agent-name" type="text" maxlength="32" autocomplete="off" spellcheck="false" placeholder="小盾">
            </div>
            <div class="settings-row-action">
              <button class="settings-save-btn" id="settings-save-agent-name" type="button">保存</button>
              <span class="settings-feedback" id="settings-agent-name-feedback"></span>
            </div>
          </div>
        </div>

        <!-- ── LLM 模型 tab ── -->
        <div class="settings-tab" data-tab="llm">
          <div class="settings-section">
            <div class="settings-section-label">当前状态</div>
            <div class="settings-config-row">
              <span class="settings-config-type">LLM</span>
              <span class="settings-config-info" id="settings-cfg-llm">—</span>
              <span class="settings-config-dot" id="settings-cfg-llm-dot"></span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">切换配置</div>
            <div class="settings-row">
              <label class="settings-label" for="settings-provider-select">提供商</label>
              <select class="settings-select" id="settings-provider-select">
                <option value="auto">自动识别</option>
                <option value="deepseek">DeepSeek</option>
                <option value="minimax">MiniMax</option>
                <option value="mimo">小米 MiMo</option>
                <option value="custom">自定义端点（本地/其他）</option>
              </select>
            </div>
            <div class="settings-row" id="settings-model-row">
              <label class="settings-label" for="settings-model-select">模型</label>
              <select class="settings-select" id="settings-model-select"></select>
            </div>
            <div class="settings-row" id="settings-official-custom-model-row" style="display:none;">
              <label class="settings-label" for="settings-official-custom-model">自定义模型名</label>
              <input class="settings-input" id="settings-official-custom-model" type="text" placeholder="如 kimi-k2.8, gpt-5.2, glm-6" autocomplete="off" spellcheck="false">
            </div>
            <!-- 自定义端点字段（选择"自定义端点"时显示） -->
            <div id="settings-custom-llm-section" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="settings-custom-baseurl">Base URL</label>
                <input class="settings-input" id="settings-custom-baseurl" type="text" placeholder="如 http://localhost:11434/v1">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="settings-custom-model">模型名称</label>
                <input class="settings-input" id="settings-custom-model" type="text" placeholder="如 llama3.2, qwen2.5, mistral">
              </div>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-llm-key">API Key</label>
              <div class="settings-secret-wrap">
                <input class="settings-input" id="settings-llm-key" type="password" placeholder="已保存的 Key 会在这里显示" autocomplete="new-password">
                <button class="settings-secret-toggle" id="settings-llm-key-toggle" type="button" aria-label="显示 API Key" title="显示/隐藏 API Key">👁</button>
              </div>
            </div>
            <div class="settings-row-action">
              <button class="settings-save-btn" id="settings-save-llm" type="button">保存</button>
              <span class="settings-feedback" id="settings-llm-feedback"></span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">模型温度</div>
            <p class="settings-hint">控制回复的随机性。0 = 确定性最高，1 = 正常创意，1.5 = 更随机。推荐 0.3–0.7。</p>
            <div class="settings-row">
              <label class="settings-label" for="settings-temperature">Temperature</label>
              <input type="range" id="settings-temperature" min="0" max="1.5" step="0.05" value="0.5" style="flex:1;cursor:pointer;">
              <span id="settings-temperature-val" style="min-width:2.8em;text-align:right;color:var(--ink2);font-size:13px;">0.50</span>
            </div>
            <div class="settings-row-action">
              <button class="settings-save-btn" id="settings-save-temperature" type="button">保存</button>
              <span class="settings-feedback" id="settings-temperature-feedback"></span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">思考模式</div>
            <p class="settings-hint">默认关闭：直接作答，响应更快、更省 token。开启后模型会先推理再回答，复杂任务更可靠（具体想多深由模型自己决定），但响应更慢。遇到难题想要更高质量时再开启。</p>
            <div class="settings-row">
              <label class="settings-label" for="settings-thinking">启用思考模式</label>
              <label class="settings-toggle">
                <input type="checkbox" id="settings-thinking">
                <span class="settings-toggle-track"></span>
              </label>
              <span class="settings-feedback" id="settings-thinking-feedback"></span>
            </div>
          </div>
        </div>

        <!-- ── 媒体能力 tab ── -->
        <div class="settings-tab" data-tab="media">
          <div class="settings-section">
            <div class="settings-section-label">当前状态</div>
            <div class="settings-config-row">
              <span class="settings-config-type">媒体</span>
              <span class="settings-config-info" id="settings-cfg-media">—</span>
              <span class="settings-config-dot" id="settings-cfg-media-dot"></span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">MiniMax API Key</div>
            <div class="settings-row">
              <label class="settings-label" for="settings-minimax-key">API Key</label>
              <input class="settings-input" id="settings-minimax-key" type="password" placeholder="填入 MiniMax API Key…" autocomplete="new-password">
            </div>
            <div class="settings-row-action">
              <button class="settings-save-btn" id="settings-save-minimax" type="button">保存</button>
              <span class="settings-feedback" id="settings-minimax-feedback"></span>
            </div>
          </div>
        </div>

        <!-- ── 社交媒体 tab ── -->
        <div class="settings-tab" data-tab="social">
          <div class="settings-section">
            <div class="settings-section-label">Discord</div>
            <div class="settings-platform-status" id="social-status-discord"></div>
            <div class="settings-row">
              <label class="settings-label" for="social-discord-token">Bot Token</label>
              <input class="settings-input" id="social-discord-token" type="password" placeholder="留空保持原值不变…" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">飞书</div>
            <div class="settings-platform-status" id="social-status-feishu"></div>
            <div class="settings-row">
              <label class="settings-label" for="social-feishu-appid">App ID</label>
              <input class="settings-input" id="social-feishu-appid" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-feishu-secret">App Secret</label>
              <input class="settings-input" id="social-feishu-secret" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-feishu-token">Verify Token</label>
              <input class="settings-input" id="social-feishu-token" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">微信公众号</div>
            <div class="settings-platform-status" id="social-status-wechat"></div>
            <div class="settings-row">
              <label class="settings-label" for="social-wechat-appid">App ID</label>
              <input class="settings-input" id="social-wechat-appid" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-wechat-secret">App Secret</label>
              <input class="settings-input" id="social-wechat-secret" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-wechat-token">Token</label>
              <input class="settings-input" id="social-wechat-token" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">企业微信</div>
            <div class="settings-platform-status" id="social-status-wecom"></div>
            <div class="settings-row">
              <label class="settings-label" for="social-wecom-botkey">Bot Key</label>
              <input class="settings-input" id="social-wecom-botkey" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="social-wecom-token">Incoming Token</label>
              <input class="settings-input" id="social-wecom-token" type="password" placeholder="留空保持原值…" autocomplete="new-password">
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">微信 ClawBot（个人微信）</div>
            <div class="settings-platform-status" id="social-status-clawbot">○ 未连接</div>
            <p class="settings-hint">点击「连接微信」后会生成二维码，用微信扫码即可绑定个人账号。凭证保存在本地，重启后无需重新扫码。</p>
            <div class="settings-row" style="gap:8px;flex-wrap:wrap;">
              <button class="settings-save-btn" id="clawbot-connect-btn" type="button" style="width:auto;padding:0 16px;">连接微信</button>
              <button class="settings-save-btn" id="clawbot-logout-btn" type="button" style="width:auto;padding:0 16px;background:var(--danger,#c0392b);">断开</button>
            </div>
            <div id="clawbot-qr-area" style="display:none;margin-top:12px;text-align:center;">
              <p class="settings-hint" style="margin-bottom:8px;">用微信扫描下方二维码：</p>
              <img id="clawbot-qr-img" src="" alt="微信二维码" style="width:200px;height:200px;border:1px solid var(--border);border-radius:4px;">
              <p class="settings-hint" style="margin-top:6px;font-size:11px;" id="clawbot-qr-hint">等待扫码…</p>
            </div>
            <span class="settings-feedback" id="clawbot-feedback"></span>
          </div>
          <div class="settings-section settings-section-action">
            <button class="settings-save-btn" id="settings-save-social" type="button">保存所有</button>
            <span class="settings-feedback" id="settings-social-feedback"></span>
          </div>
        </div>

        <!-- ── 语音 tab ── -->
        <div class="settings-tab" data-tab="voice">
          <div class="settings-section">
            <div class="settings-section-label">语音识别配置</div>
            <div class="settings-row">
              <label class="settings-label" for="voice-auto-key">粘贴 Key 自动识别厂商</label>
              <input class="settings-input" type="password" id="voice-auto-key" placeholder="阿里云 / 腾讯云 / 讯飞 / 火山豆包 ASR Key">
              <span id="voice-auto-detect" style="color:var(--cool);font-size:12px;min-width:86px;text-align:right;"></span>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-provider-select">服务商</label>
              <select class="settings-select" id="voice-provider-select">
                <option value="local">本机识别（macOS）</option>
                <option value="aliyun">阿里云百炼（推荐）</option>
                <option value="volcengine">火山引擎豆包 ASR</option>
                <option value="tencent">腾讯云 ASR</option>
                <option value="xunfei">科大讯飞 RTASR</option>
              </select>
            </div>
            <div id="voice-cred-aliyun">
              <div class="settings-row">
                <label class="settings-label" for="voice-aliyun-key">阿里云 API Key</label>
                <input class="settings-input" type="password" id="voice-aliyun-key" placeholder="留空则不修改">
              </div>
            </div>
            <div id="voice-cred-tencent" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="voice-tencent-sid">SecretId</label>
                <input class="settings-input" type="password" id="voice-tencent-sid" placeholder="留空则不修改">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="voice-tencent-skey">SecretKey</label>
                <input class="settings-input" type="password" id="voice-tencent-skey" placeholder="留空则不修改">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="voice-tencent-appid">AppId</label>
                <input class="settings-input" type="text" id="voice-tencent-appid" placeholder="腾讯云 AppId">
              </div>
            </div>
            <div id="voice-cred-volcengine" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="voice-volc-apikey">API Key</label>
                <div class="settings-secret-wrap">
                  <input class="settings-input" type="password" id="voice-volc-apikey" placeholder="输入后自动保存" autocomplete="new-password">
                  <button class="settings-secret-toggle" id="voice-volc-apikey-toggle" type="button" aria-label="显示 API Key" title="显示/隐藏 API Key">👁</button>
                </div>
              </div>
            </div>
            <div id="voice-cred-xunfei" style="display:none;">
              <div class="settings-row">
                <label class="settings-label" for="voice-xunfei-appid">AppId</label>
                <input class="settings-input" type="text" id="voice-xunfei-appid" placeholder="讯飞 AppId">
              </div>
              <div class="settings-row">
                <label class="settings-label" for="voice-xunfei-apikey">ApiKey</label>
                <input class="settings-input" type="password" id="voice-xunfei-apikey" placeholder="留空则不修改">
              </div>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-label">语音识别灵敏度</div>
            <p class="settings-hint">调节麦克风触发阈值。越低越灵敏，越高越需要大声说话。默认 0.008。</p>
            <div class="settings-row">
              <label class="settings-label" for="settings-voice-threshold">触发阈值</label>
              <input type="range" id="settings-voice-threshold" min="0.002" max="0.04" step="0.001" value="0.008" style="flex:1;cursor:pointer;">
              <span id="settings-voice-threshold-val" style="min-width:3.5em;text-align:right;color:var(--ink2);font-size:13px;">0.008</span>
            </div>
          </div>

          <div class="settings-section">
            <div class="settings-section-label">设备设置</div>
            <div class="settings-row">
              <label class="settings-label" for="voice-lang-select">识别语言</label>
              <select class="settings-select" id="voice-lang-select">
                <option value="zh-CN">中文（普通话）</option>
                <option value="en-US">English (US)</option>
              </select>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-mic-select">麦克风</label>
              <select class="settings-select" id="voice-mic-select">
                <option value="">系统默认麦克风</option>
              </select>
              <button class="settings-save-btn" id="voice-refresh-mics" type="button" style="padding:0 10px;">刷新</button>
            </div>
            <p class="settings-hint" id="voice-mic-status" style="margin-top:-2px;">更换麦克风后，重新开启语音对话生效。</p>
            <div class="settings-row">
              <label class="settings-label" for="voice-auto-send">识别后自动发送</label>
              <input id="voice-auto-send" type="checkbox" checked style="width:auto;flex:none;">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="voice-auto-mic">启动时自动开启麦克风</label>
              <input id="voice-auto-mic" type="checkbox" style="width:auto;flex:none;">
            </div>
          </div>

          <div class="settings-section settings-section-action">
            <button class="settings-save-btn" id="settings-save-voice" type="button">保存</button>
            <span class="settings-feedback" id="settings-voice-feedback"></span>
          </div>
        </div>

        <!-- ── 上网搜索 tab ── -->
        <div class="settings-tab" data-tab="web-search">
          <div class="settings-section">
            <div class="settings-section-label">搜索引擎</div>
            <p class="settings-hint">Agent 调用 web_search 时分两梯队：第一梯队（带 key 的 API：Serper → Brave → Tavily → SearXNG）按优先级尝试；都没结果时，第二梯队（Bing / Jina / DuckDuckGo，无需配置）并行兜底。配任意一个 key 都能显著提升质量和稳定性，多配几个可避免单一额度用尽时搜索失败。</p>

            <div class="settings-row">
              <label class="settings-label" for="websearch-serper-key">Serper API Key</label>
              <input class="settings-input" type="password" id="websearch-serper-key" placeholder="留空则不修改">
            </div>
            <p class="settings-hint">在 <a href="https://serper.dev" target="_blank" style="color:var(--cool)">serper.dev</a> 注册后获取（每月 2500 次免费）。Google SERP JSON 接口，最稳定。</p>

            <div class="settings-row">
              <label class="settings-label" for="websearch-brave-key">Brave API Key</label>
              <input class="settings-input" type="password" id="websearch-brave-key" placeholder="留空则不修改">
            </div>
            <p class="settings-hint">在 <a href="https://brave.com/search/api" target="_blank" style="color:var(--cool)">brave.com/search/api</a> 获取（每月 2000 次免费）。独立索引，Serper 的可靠兜底。</p>

            <div class="settings-row">
              <label class="settings-label" for="websearch-tavily-key">Tavily API Key</label>
              <input class="settings-input" type="password" id="websearch-tavily-key" placeholder="留空则不修改">
            </div>
            <p class="settings-hint">在 <a href="https://tavily.com" target="_blank" style="color:var(--cool)">tavily.com</a> 获取（每月 1000 次免费）。面向 LLM 的搜索接口。</p>

            <div class="settings-row">
              <label class="settings-label" for="websearch-jina-key">Jina API Key</label>
              <input class="settings-input" type="password" id="websearch-jina-key" placeholder="留空则不修改">
            </div>
            <p class="settings-hint">在 <a href="https://jina.ai" target="_blank" style="color:var(--cool)">jina.ai</a> 获取（有免费额度）。s.jina.ai 搜索接口，第二梯队兜底之一。</p>

            <div class="settings-row">
              <label class="settings-label" for="websearch-searxng-url">SearXNG URL</label>
              <input class="settings-input" type="text" id="websearch-searxng-url" placeholder="https://your-searxng-instance.com">
            </div>
            <p class="settings-hint">选填。自托管 SearXNG 实例地址（去隐私的元搜索引擎）。要带 http:// 或 https://。</p>
          </div>

          <div class="settings-section">
            <div class="settings-section-label">当前状态</div>
            <div class="settings-config-row">
              <span class="settings-config-type">Serper</span>
              <span class="settings-config-info" id="websearch-status-serper">—</span>
            </div>
            <div class="settings-config-row">
              <span class="settings-config-type">Brave</span>
              <span class="settings-config-info" id="websearch-status-brave">—</span>
            </div>
            <div class="settings-config-row">
              <span class="settings-config-type">Tavily</span>
              <span class="settings-config-info" id="websearch-status-tavily">—</span>
            </div>
            <div class="settings-config-row">
              <span class="settings-config-type">Jina</span>
              <span class="settings-config-info" id="websearch-status-jina">—</span>
            </div>
            <div class="settings-config-row">
              <span class="settings-config-type">SearXNG</span>
              <span class="settings-config-info" id="websearch-status-searxng">—</span>
            </div>
          </div>

          <div class="settings-section settings-section-action">
            <button class="settings-save-btn" id="settings-save-web-search" type="button">保存</button>
            <span class="settings-feedback" id="settings-web-search-feedback"></span>
          </div>
        </div>

        <!-- ── 安全沙箱 tab ── -->
        <div class="settings-tab" data-tab="security">
          <div class="settings-section">
            <div class="settings-section-label">文件沙箱</div>
            <p class="settings-hint">开启后文件读写只允许在 sandbox/ 目录内。关闭后 Agent 可操作系统任意位置的文件，请谨慎使用。</p>
            <div class="settings-row">
              <label class="settings-label" for="security-file-sandbox">启用文件沙箱</label>
              <label class="settings-toggle">
                <input type="checkbox" id="security-file-sandbox" checked>
                <span class="settings-toggle-track"></span>
              </label>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">命令执行沙箱</div>
            <p class="settings-hint">开启后 exec_command 工作目录锁定在 sandbox/，且禁止使用绝对路径和父目录引用。关闭后命令可访问系统任意目录。</p>
            <div class="settings-row">
              <label class="settings-label" for="security-exec-sandbox">启用执行沙箱</label>
              <label class="settings-toggle">
                <input type="checkbox" id="security-exec-sandbox" checked>
                <span class="settings-toggle-track"></span>
              </label>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">局域网访问</div>
            <p class="settings-hint">允许同一局域网内的设备访问本机小盾 API，用于多台小盾互相通信。开启或关闭后需要重启应用生效。</p>
            <div class="settings-row">
              <label class="settings-label" for="security-lan-access">允许局域网访问</label>
              <label class="settings-toggle">
                <input type="checkbox" id="security-lan-access">
                <span class="settings-toggle-track"></span>
              </label>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">工具黑名单</div>
            <p class="settings-hint">勾选后该工具将被拒绝执行，对话中 Agent 调用时会收到"已被安全策略禁用"错误。</p>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="exec_command"> exec_command &nbsp;<span style="color:var(--ink2);font-size:12px;">（执行 shell 命令）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="browser_read"> browser_read &nbsp;<span style="color:var(--ink2);font-size:12px;">（浏览器渲染访问）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="fetch_url"> fetch_url &nbsp;<span style="color:var(--ink2);font-size:12px;">（HTTP 请求）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="web_search"> web_search &nbsp;<span style="color:var(--ink2);font-size:12px;">（网页搜索）</span></label></div>
            <div class="settings-row"><label class="settings-label"><input type="checkbox" class="security-blocked-tool" value="ui_set"> ui_set &nbsp;<span style="color:var(--ink2);font-size:12px;">（投影声明式界面 surface）</span></label></div>
          </div>
          <div class="settings-section settings-section-action">
            <button class="settings-save-btn" id="settings-save-security" type="button">保存</button>
            <button class="settings-save-btn hidden" id="settings-restart-security" type="button" style="width:auto;padding:0 14px;">立即重启</button>
            <span class="settings-feedback" id="settings-security-feedback"></span>
          </div>
        </div>

        <!-- ── 高级功能 tab ── -->
        <div class="settings-tab" data-tab="advanced">
          <div class="settings-section">
            <div class="settings-section-label">地图服务</div>
            <p class="settings-hint">为位置、行程等功能提供统一真实地图。凭证仅保存在本机加密存储中，不会写入项目源码或返回安全密钥明文。</p>
            <div class="settings-config-row">
              <span class="settings-config-type">状态</span>
              <span class="settings-config-info" id="settings-map-status">正在检查…</span>
              <span class="settings-config-dot" id="settings-map-status-dot"></span>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-map-provider">地图服务商</label>
              <select class="settings-select" id="settings-map-provider">
                <option value="amap">高德地图 JS API 2.0</option>
              </select>
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-amap-key">Web 端 Key</label>
              <input class="settings-input" id="settings-amap-key" type="password" placeholder="留空保持现有 Key 不变" autocomplete="new-password" spellcheck="false">
            </div>
            <div class="settings-row">
              <label class="settings-label" for="settings-amap-security">安全密钥</label>
              <input class="settings-input" id="settings-amap-security" type="password" placeholder="securityJsCode，留空保持不变" autocomplete="new-password" spellcheck="false">
            </div>
            <p class="settings-hint">请在高德开放平台创建“Web端（JS API）”Key。安全密钥只在本地代理请求中使用，地图页面无法读取其明文。</p>
            <div class="settings-row-action" style="gap:8px;flex-wrap:wrap;">
              <button class="settings-save-btn" id="settings-save-map" type="button">保存地图配置</button>
              <button class="settings-save-btn" id="settings-clear-map" type="button" style="width:auto;padding:0 14px;background:transparent;border:1px solid var(--line);color:var(--ink2);">清除</button>
              <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noreferrer" class="settings-map-link">申请高德 Key ↗</a>
              <span class="settings-feedback" id="settings-map-feedback"></span>
            </div>
          </div>
          <div class="settings-section">
            <div class="settings-section-label">共用范围</div>
            <p class="settings-hint">配置一次后，天气灾害、位置卡片和后续地图页面都会通过统一 MapService 使用同一地图服务。</p>
          </div>
        </div>

      </div><!-- /settings-content -->
    </div><!-- /settings-body -->
  </div>
</div>
`;

const createVoicePanel = () => `
<div class="voice-panel" id="voice-panel">
  <canvas id="voice-canvas" width="160" height="160"></canvas>
  <div class="voice-transcript" id="voice-transcript"></div>
</div>
`;

const createVideoPanel = () => `
<div class="video-panel" id="video-panel">
  <div class="media-stage-head">
    <div class="media-stage-title" id="video-title">视频</div>
    <button class="video-exit-btn" id="video-exit-btn" type="button" title="关闭视频">x</button>
  </div>
  <div class="video-surface" id="video-surface">
    <div class="video-backdrop" id="video-backdrop"></div>
    <video id="video-feed" playsinline controls></video>
    <iframe id="video-frame" title="视频播放器" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen hidden></iframe>
    <div class="video-empty" id="video-empty">无视频源</div>
  </div>
</div>
`;

const createImagePanel = () => `
<div class="image-panel" id="image-panel">
  <div class="media-stage-head">
    <div class="media-stage-title" id="image-title">图片</div>
    <button class="image-exit-btn" id="image-exit-btn" type="button" title="关闭图片">x</button>
  </div>
  <div class="image-surface" id="image-surface">
    <img id="image-display" alt="" />
    <div class="image-empty" id="image-empty">无图片源</div>
  </div>
</div>
`;

const createPanelTabs = () => `
<button id="panel-l1-tab" class="panel-tab panel-tab-left" aria-label="切换左面板" title="切换左面板 [ "></button>
<button id="panel-l2-tab" class="panel-tab panel-tab-right" aria-label="切换右面板" title="切换右面板 ] "></button>
`;

export function createBrainUiMarkup() {
  return [
    createMapStage(),
    createPrimaryPanel(),
    createSecondaryPanel(),
    createConsole(),
    createTooltip(),
    createSettingsModal(),
    createVideoPanel(),
    createImagePanel(),
    createRagManagerPanel(),
    createHotspotPanel(),
    createDocPanel(),
  ].join("\n\n");
}

export function renderBrainUiApp(root = document.body) {
  root.dataset.theme = "midnight";
  root.innerHTML = createBrainUiMarkup();
}
