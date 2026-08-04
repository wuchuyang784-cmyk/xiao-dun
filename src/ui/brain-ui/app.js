import { renderBrainUiApp } from "./app-shell.js";
import { API } from "./api-client.js";
import { bootstrapScene } from "../scene-shell/bootstrap.js";
import { initChat, friendlyChannelLabel } from "./chat.js";
import { initPanelCollapse } from "./panel-collapse.js";
import { ThoughtStream } from "./thought-stream.js";
import { initVoicePanel } from "./voice-panel.js";
import { initHotspot, setHotspotMode, moveVoicePanelToBody, restoreVoicePanel } from "./hotspot.js";
import { initDocPanel, setDocPanelMode } from "./doc.js";
import { initFraudMap } from "./fraud-map.js";
import { initRagManager } from "./rag-manager.js";
import { initWechatPopup, showWechatPopup } from "./wechat-popup.js";
import { initFeishuPopup, showFeishuPopup } from "./feishu-popup.js";
import { extractAssistantMessageContent, isAssistantMessageEvent, resolveAssistantMessageId } from "./message-event.js";
import { sanitizeAssistantReplyForDelivery } from "../../runtime/markers.js";
renderBrainUiApp(document.body);
const fraudMap = initFraudMap();
const THEME_KEY = "jarvis-brain-ui-theme";
const ACTIVATION_WARMUP_KEY = "xiaodun_activation_warmup_until";
const UI_ZOOM_STORAGE_KEY = "xiaodun_ui_zoom_factor";
const MAX_CHAT_HISTORY = 60;
const DEFAULT_AGENT_NAME = "小盾";
const DEFAULT_UI_ZOOM = 1.1;
const MIN_UI_ZOOM = 0.8;
const MAX_UI_ZOOM = 1.8;
const UI_ZOOM_STEP = 0.1;
const UI_ZOOM_WHEEL_STEP = 0.05;

const themeSwitcher = document.getElementById("theme-switcher");
const resetViewBtn = document.getElementById("reset-view-btn");
const brandNameEl = document.getElementById("agent-brand-name");
const focusBlockEl = document.getElementById("focus-block");
const focusStackEl = document.getElementById("focus-stack");
const focusDepthEl = document.getElementById("focus-depth");

let agentName = DEFAULT_AGENT_NAME;
let currentUiZoom = DEFAULT_UI_ZOOM;
let chat = null;
let ragManager = null;
// Real-time assistant reply state. Keep these at module scope because the SSE
// event handler and the stream handlers share the same conversation turn.
let liveReplyActive = false;
let liveRawText = "";
let lastJarvisContent = "";
// 鐢?initSettings() 鍐呴儴璧嬪€硷紝渚?chat.js 鐨勬枩鏉犲懡浠ゆ墦寮€璁剧疆闈㈡澘
let openSettingsRef = null;

function addMsg(...args) { return chat?.addMsg(...args); }
function openChat(...args) { return chat?.openChat(...args); }
function updateLastJarvisMsg(...args) { return chat?.updateLastJarvisMsg(...args); }

function isTyping() { return chat?.isTyping() || false; }

function defaultInputPlaceholder() {
  return "向" + agentName + "发送消息";
}

function clampZoomFactor(factor) {
  return Math.min(MAX_UI_ZOOM, Math.max(MIN_UI_ZOOM, Number(factor) || DEFAULT_UI_ZOOM));
}

function saveUiZoom(factor) {
  try {
    localStorage.setItem(UI_ZOOM_STORAGE_KEY, String(factor));
  } catch {}
}

function loadSavedUiZoom() {
  try {
    const raw = Number(localStorage.getItem(UI_ZOOM_STORAGE_KEY));
    if (Number.isFinite(raw)) return clampZoomFactor(raw);
  } catch {}
  return DEFAULT_UI_ZOOM;
}

function applyUiZoom(factor, { persist = true } = {}) {
  const nextZoom = clampZoomFactor(factor);
  currentUiZoom = nextZoom;

  const bridge = window.xiaodun;
  if (bridge?.isElectron && typeof bridge.setZoomFactor === "function") {
    bridge.setZoomFactor(nextZoom);
  } else {
    document.documentElement.style.zoom = String(nextZoom);
  }

  if (persist) saveUiZoom(nextZoom);
}

function stepUiZoom(delta) {
  const nextZoom = Math.round((currentUiZoom + delta) * 100) / 100;
  applyUiZoom(nextZoom);
}

function initUiZoom() {
  const bridge = window.xiaodun;
  const initialZoom = loadSavedUiZoom();

  if (!bridge?.isElectron) {
    applyUiZoom(initialZoom, { persist: false });
  } else {
    try {
      const bridgeZoom = bridge.getZoomFactor?.();
      if (typeof bridgeZoom === "number" && Number.isFinite(bridgeZoom)) {
        currentUiZoom = clampZoomFactor(bridgeZoom);
      }
    } catch {}
    applyUiZoom(initialZoom, { persist: false });
  }

  window.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    stepUiZoom(event.deltaY < 0 ? UI_ZOOM_WHEEL_STEP : -UI_ZOOM_WHEEL_STEP);
  }, { passive: false, capture: true });

  window.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;

    const key = event.key;
    if (key === "+" || key === "=" || key === "Add") {
      event.preventDefault();
      stepUiZoom(UI_ZOOM_STEP);
      return;
    }

    if (key === "-" || key === "_" || key === "Subtract") {
      event.preventDefault();
      stepUiZoom(-UI_ZOOM_STEP);
      return;
    }

    if (key === "0") {
      event.preventDefault();
      applyUiZoom(DEFAULT_UI_ZOOM);
    }
  });
}

function setAgentName(nextName) {
  const normalized = String(nextName || "").trim() || DEFAULT_AGENT_NAME;
  agentName = normalized;
  document.title = `${normalized} 路 小盾防诈`;
  if (brandNameEl) brandNameEl.textContent = `${normalized} AI Agent`;
  const input = document.getElementById("msg-input");
  if (input && !chat?.isComposerLocked?.() && document.activeElement === input) input.placeholder = defaultInputPlaceholder();
  document.querySelectorAll(".msg-jarvis .msg-label").forEach((el) => {
    el.textContent = normalized;
  });
}

async function loadAgentProfile() {
  try {
    const res = await fetch(`${API}/agent-profile`);
    if (!res.ok) return;
    const data = await res.json();
    setAgentName(data.name);
  } catch {}
}

function readCSSVar(name) {
  return getComputedStyle(document.body).getPropertyValue(name).trim();
}

function applyTheme(theme) {
  document.body.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
  document.querySelectorAll(".theme-dot").forEach(el => {
    el.classList.toggle("active", el.dataset.t === theme);
  });
  // 主题色变了，ECharts 渲染的地图配色需要重读 CSS 变量
  fraudMap?.refresh?.();
}

(function initTheme() {
  let saved = "midnight";
  try { saved = localStorage.getItem(THEME_KEY) || "midnight"; } catch {}
  applyTheme(saved);
})();

themeSwitcher?.querySelectorAll(".theme-dot").forEach(el => {
  el.addEventListener("click", () => applyTheme(el.dataset.t));
});

const connStateEl = document.getElementById("conn-state");
function setConnectionState(text, live = true) {
  if (!connStateEl) return;
  connStateEl.innerHTML = live ? `<span class="live-dot"></span>${text}` : text;
}

function cleanStreamText(rawText) {
  return sanitizeAssistantReplyForDelivery(rawText);
}

function parseUserMessageInput(raw) {
  const text = String(raw || "");
  const match = text.match(/^\[([^\]]+)\]\s+(\S+)\s+\[([^\]]+)\]\s+([\s\S]*)$/);
  if (!match) return { content: text.trim(), time: null };
  return { fromId: match[1], timestamp: match[2], channel: match[3], content: match[4].trim(), time: formatMsgTime(match[2]) };
}

function formatMsgTime(stamp) {
  if (!stamp) return null;
  const m = String(stamp).match(/T(\d{2}):(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}:${m[3]}`;
  const m2 = String(stamp).match(/(\d{2}):(\d{2}):(\d{2})/);
  if (m2) return `${m2[1]}:${m2[2]}:${m2[3]}`;
  return null;
}

const L1 = new ThoughtStream("si-l1", "cool", {
  readCSSVar,
  thinkingLabel: "思考中",
  thinkingDoneLabel: "思考完成",
  toolDetailLength: 140,
});
const L2 = new ThoughtStream("si-l2", "warm", {
  readCSSVar,
  thinkingLabel: "思考中",
  thinkingDoneLabel: "思考完成",
  toolDetailLength: 220,
});

// L1 = processing flow triggered by user messages; L2 = processing flow triggered by TICK.
// stream_*/tool_call events emitted by the backend carry no path tag;
// routing to the correct panel is determined by the most recent message_received / tick event.
let currentPath = "l2";
function currentStream() { return currentPath === "l1" ? L1 : L2; }

// ---- 执行规划面板 ----
let planPath = "idle";          // "active" | "idle"
let planSteps = [];             // [{ toolName, status, startTime }]
let planCardEl = null;

const PLAN_TOOL_ZH = {
  send_message: "回复用户",  web_search: "搜索网页",  fetch_url: "抓取网页",
  read_file: "读取文件",     write_file: "写入文件", search_memory: "检索记忆",
  recall_memory: "唤起记忆",  fraud_rule_screen: "反诈规则筛查",
};
function planToolLabel(name) { return PLAN_TOOL_ZH[name] || name; }
function escapeHtml(s) { return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }

function openPlanCard(userText) {
  planSteps = [];
  const list = document.getElementById("plan-list");
  if (!list) return;
  closePlanCard();
  planCardEl = document.createElement("div");
  planCardEl.className = "plan-card";
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`;
  planCardEl.innerHTML = `<div class="plan-header"><span class="plan-title">${escapeHtml(userText.slice(0,40))}</span><span class="plan-time">${time}</span></div><div class="plan-steps"></div>`;
  list.prepend(planCardEl);
  const pill = document.getElementById("pill-l2");
  if (pill) { pill.textContent = "执行中"; pill.className = "pill pill-warm"; }
}

function addPlanStep(toolName) {
  if (!planCardEl) return;
  const steps = planCardEl.querySelector(".plan-steps");
  if (!steps) return;
  const entry = { toolName, status: "pending", startTime: Date.now() };
  planSteps.push(entry);
  const stepEl = document.createElement("div");
  stepEl.className = "plan-step";
  stepEl.dataset.tool = toolName;
  stepEl.innerHTML = `<span class="step-status">○</span><span class="step-name">${escapeHtml(planToolLabel(toolName))}</span><span class="step-time"></span>`;
  steps.appendChild(stepEl);
}

function updatePlanStep(toolName, status) {
  if (!planCardEl) return;
  const safeName = toolName.replace(/"/g,"");
  const stepEl = planCardEl.querySelector(`.plan-step[data-tool="${safeName}"]`);
  if (!stepEl) return;
  const entry = planSteps.find(s => s.toolName === toolName);
  const elapsed = entry ? ((Date.now() - entry.startTime) / 1000).toFixed(1) + "s" : "";
  stepEl.querySelector(".step-status").textContent = status === "done" ? "\u2713" : "\u2717";
  stepEl.querySelector(".step-status").className = `step-status ${status}`;
  stepEl.querySelector(".step-time").textContent = elapsed;
}

function closePlanCard() {
  if (planCardEl) { planCardEl.classList.add("plan-done"); }
  planCardEl = null;
  planSteps = [];
  const pill = document.getElementById("pill-l2");
  if (pill) { pill.textContent = "等待指令"; pill.className = "pill"; }
}

// ---- 运行时长计时器 ----
let uptimeStart = Date.now();
setInterval(() => {
  const el = document.getElementById("uptime");
  if (!el) return;
  const s = Math.floor((Date.now() - uptimeStart) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  el.textContent = `${h}h ${m}m`;
}, 30_000);

function isBusyErrorMessage(message = "") {
  return /(429|rate limit|too many requests|busy|overload|temporarily unavailable|server busy|resource exhausted)/i.test(String(message || ""));
}

function formatRetryDelay(ms) {
  if (!ms || ms < 1000) return `${ms || 0}ms`;
  return `${(ms / 1000).toFixed(ms % 1000 === 0 ? 0 : 1)}s`;
}

let tokenAccum = 0;
let tokenWindow = Date.now();
const tokRateEl = document.getElementById("tok-rate");

// 璁板繂绯荤粺瑙傛祴锛圡emory-Optimization v0.1 Phase 0锛夛細姣?60s 鎷変竴娆¤繎 1 灏忔椂鐨?audit stats銆?
// 鏄剧ず"N 娆★紙骞冲潎 K 鏉★級"鈥斺€旀鏁颁唬琛ㄧ郴缁熸椿璺冨害锛屽钩鍧囨潯鏁颁唬琛ㄥ彫鍥?鎶藉彇鐨勫仴搴峰害銆?
// 0 鍛戒腑鏁颁細璁╂暟瀛楀彉姗欐彁閱掞紙鍛戒腑鐜囦綆 = 鍙兘鏈夊彫鍥炴紡锛夛紱绾綉缁?鏈嶅姟澶辫触淇濇寔 鈥?涓嶅憡璀︺€?
const memRecallEl = document.getElementById("mem-recall-rate");
const memExtractEl = document.getElementById("mem-extract-rate");
const ctxTokenCountEl = document.getElementById("ctx-token-count");
const ctxStatEl = document.getElementById("ctx-stat");

const llmProviderNameEl = document.getElementById("llm-provider-name");
async function refreshLlmProviderName() {
  if (!llmProviderNameEl) return;
  try {
    const data = await fetch(`${API}/settings`).then((r) => r.json());
    const llm = data?.llm;
    if (llm) llmProviderNameEl.textContent = `${llm.provider || "-"} / ${llm.model || "-"}`;
  } catch {}
}
refreshLlmProviderName();

// 鈹€鈹€ AI 褰撳墠姝ｅ湪鍋氫粈涔堬細娲剧敓灞曠ず 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 鍖楁瀬鏄燂紙[[feedback-ai-be-itself]]锛夛細閫氫俊闂闈犵晫闈晶娲剧敓鍙鍖栬В鍐筹紝涓嶉€?AI 瀛︿汉寮€鍙ｃ€?
// 宸ヤ綔鏂瑰紡锛氱函琚姩鎺ユ敹 tool_call 浜嬩欢娴侊紝鎸夊伐鍏峰悕褰掔被缁熻鏈€杩?60s 娲诲姩锛岃嚜鍔ㄦ帹瀵煎綋鍓嶆椿鍔ㄦ爣绛俱€?
// AI 瀹屽叏涓嶉渶瑕佷负姝ゅ鍋氫换浣曞姩浣滐紱瀹冨彧绠″共娲伙紝UI 鑷繁鎶?鍦ㄥ共浠€涔?缈昏瘧缁欑敤鎴风湅銆?
const AI_ACTIVITY_WINDOW_MS = 60_000;
const AI_ACTIVITY_IDLE_AFTER_MS = 15_000;
const AI_TOOL_GROUPS = {
  "\u626b\u63cf\u6587\u4ef6": new Set(["read_file", "list_dir"]),
  "\u6539\u52a8\u6587\u4ef6": new Set(["write_file", "make_dir", "delete_file"]),
  "\u6267\u884c\u547d\u4ee4": new Set(["exec_command", "exec_quick_command", "exec_task_command", "exec_background_command", "download_file", "kill_process", "list_processes"]),
  "\u4e0a\u7f51": new Set(["fetch_url", "web_search", "browser_read"]),
  "\u8c03\u53d6\u8bb0\u5fc6": new Set(["search_memory", "recall_memory", "probe_memory", "upsert_memory", "merge_memories", "downgrade_memory"]),
  "推送界面": new Set(["ui_set", "focus_banner"]),
  "媒体处理": new Set(["media_mode"]),
  "\u56de\u590d\u7528\u6237": new Set(["send_message", "express"]),
};
const aiActivityLog = [];
let aiActivityFirstTs = 0;
let aiActivityTimer = null;
const aiActivityEl = document.getElementById("ai-activity");
const aiActivityLabelEl = document.getElementById("ai-activity-label");
const aiActivityDetailEl = document.getElementById("ai-activity-detail");

function classifyTool(name) {
  for (const [label, set] of Object.entries(AI_TOOL_GROUPS)) {
    if (set.has(name)) return label;
  }
  return "\u5904\u7406\u4e8b\u52a1";
}

function recordAiActivity(name) {
  if (!name) return;
  const now = Date.now();
  if (aiActivityLog.length === 0) aiActivityFirstTs = now;
  aiActivityLog.push({ name, ts: now, group: classifyTool(name) });
  refreshAiActivity();
}

function refreshAiActivity() {
  if (!aiActivityEl) return;
  const now = Date.now();
  while (aiActivityLog.length && now - aiActivityLog[0].ts > AI_ACTIVITY_WINDOW_MS) {
    aiActivityLog.shift();
  }
  if (aiActivityLog.length === 0) {
    aiActivityEl.dataset.state = "idle";
    aiActivityLabelEl.textContent = "\u7a7a\u95f2";
    aiActivityDetailEl.textContent = "";
    aiActivityFirstTs = 0;
    return;
  }
  const lastTs = aiActivityLog[aiActivityLog.length - 1].ts;
  if (now - lastTs > AI_ACTIVITY_IDLE_AFTER_MS) {
    aiActivityEl.dataset.state = "idle";
    aiActivityLabelEl.textContent = "刚刚完成";
    const ago = Math.round((now - lastTs) / 1000);
    aiActivityDetailEl.textContent = String(ago) + "s 前停止";
    return;
  }
  const counts = {};
  for (const e of aiActivityLog) counts[e.group] = (counts[e.group] || 0) + 1;
  let domGroup = "\u5904\u7406\u4e8b\u52a1";
  let domCount = 0;
  for (const [g, c] of Object.entries(counts)) {
    if (c > domCount) { domCount = c; domGroup = g; }
  }
  aiActivityEl.dataset.state = "busy";
  aiActivityLabelEl.textContent = `\u6b63\u5728${domGroup}`;
  const elapsed = Math.round((now - (aiActivityFirstTs || lastTs)) / 1000);
  aiActivityDetailEl.textContent = `· ${aiActivityLog.length} 次工具调用 · ${elapsed}s`;
}

if (aiActivityEl) {
  aiActivityEl.dataset.state = "idle";
  aiActivityTimer = setInterval(refreshAiActivity, 1000);
}

async function refreshMemoryAuditStats() {
  if (!memRecallEl || !memExtractEl) return;
  try {
    const res = await fetch("/audit/stats?hours=1", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const r = data?.recall || {};
    const e = data?.extract || {};
    const rTotal = Number(r.total || 0);
    const rAvg = Number(r.avg_chosen || 0);
    const rZero = Number(r.zero_match_count || 0);
    const eTotal = Number(e.total || 0);
    const eAvg = Number(e.avg_extracted || 0);
    const eSkip = Number(e.skipped_count || 0);
    memRecallEl.textContent = rTotal ? `${rTotal}路${rAvg.toFixed(1)}` : "0";
    memExtractEl.textContent = eTotal ? `${eTotal}路${eAvg.toFixed(1)}` : "0";
    memRecallEl.style.color = (rTotal > 0 && rZero / rTotal > 0.2) ? "var(--warn, #e8a23a)" : "";
    memExtractEl.style.color = (eTotal > 0 && eSkip / eTotal > 0.5) ? "var(--warn, #e8a23a)" : "";
  } catch {
    // 闈欓粯锛歞ev/build 鏃╂湡 audit 琛ㄥ彲鑳借繕娌℃暟鎹紝淇濇寔 鈥?鍗冲彲
  }
}
refreshMemoryAuditStats();
setInterval(refreshMemoryAuditStats, 60_000);

async function refreshContextStats() {
  if (!ctxTokenCountEl) return;
  try {
    const res = await fetch("/api/v1/context/stats", { cache: "no-store" });
    if (!res.ok) return;
    const env = await res.json();
    const d = env.data || {};
    const tokens = Number(d.estimatedTokens || 0);
    if (!tokens) {
      ctxTokenCountEl.textContent = "—";
      ctxTokenCountEl.className = "stat-value";
      return;
    }
    const formatted = tokens >= 1000 ? (tokens / 1000).toFixed(1) + "k" : String(tokens);
    ctxTokenCountEl.textContent = formatted;
    if (tokens >= 16000) ctxTokenCountEl.className = "stat-value ctx-high";
    else if (tokens >= 8000) ctxTokenCountEl.className = "stat-value ctx-mid";
    else ctxTokenCountEl.className = "stat-value ctx-low";
  } catch {}
}
refreshContextStats();
setInterval(refreshContextStats, 30_000);
if (ctxStatEl) {
  ctxStatEl.addEventListener("click", () => {
    if (typeof window.__triggerContextCompress === 'function') {
      window.__triggerContextCompress();
    } else {
      fetch("/api/v1/context/compress", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
        .then(r => r.json())
        .then(env => alert("✅ " + (env.data?.before || 0) + " → " + (env.data?.after || 0) + " 条消息已清理"))
        .catch(e => alert("❌ 压缩失败：" + e.message));
    }
  });
}

function bumpTokens(text) {
  tokenAccum += (text || "").length / 3.4;
  const now = Date.now();
  if (now - tokenWindow > 700) {
    const rate = tokenAccum / ((now - tokenWindow) / 1000);
    tokRateEl.textContent = rate.toFixed(1);
    tokenAccum = 0;
    tokenWindow = now;
    setTimeout(() => { if (tokRateEl.textContent !== "-" && tokenAccum === 0) tokRateEl.textContent = "-"; }, 4000);
  }
}

// 鈹€鈹€ 涓撴敞甯ц瀵熼潰鏉?(focus stack) 鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€鈹€
// 璁捐鏂囨。 7.5锛氱敤鎴峰繀椤荤湅寰楄 Agent 姝ゅ埢鍦ㄤ笓娉ㄤ粈涔堛€?
// 绾簨浠堕┍鍔細focus_frame 鈫?鍏ㄩ噺閲嶆覆鏌擄紱focus_compressed 鈫?鍦ㄦ爤椤跺熬閮ㄨ拷鍔?conclusion 骞舵贰鍏ャ€?

function escapeFocusText(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function truncateConclusion(text, max = 60) {
  const s = String(text || "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trim() + "…";
}

function renderFocusFrame(frame, { isTop }) {
  const conclusions = Array.isArray(frame?.conclusions) ? frame.conclusions : [];

  // 主行显示策略（progressive disclosure）：
  //   1. 鏈?conclusion 鈫?鏄剧ず鏈€鏂颁竴鏉★紙杩欐槸瀛愬抚 pop 鏃跺帇缂╁嚭鐨?1-2 鍙ヨ瘽缁撹锛?
  //   2. 鏃?conclusion 浣嗘湁 topic 鈫?鏄剧ず topic锛坴0 鏄?ngram锛屽嚑鐧?ms 鍚庤 LLM refine 鎴愪汉绫诲彲璇荤煭璇級
  //   3. 閮芥病 鈫?杩斿洖绌轰富琛岋紙涓婂眰 renderFocusStack 浼氳繘涓€姝ヨ繃婊わ級
  // 早期 conclusion 作为弱化辅助行（栈顶帧才显示，避免视觉过载）
  const latest = conclusions.length > 0 ? conclusions[conclusions.length - 1] : "";
  const earlier = conclusions.length > 1 ? conclusions.slice(0, -1) : [];
  const topicSummary = Array.isArray(frame?.topic) && frame.topic.length > 0
    ? frame.topic.slice(0, 3).join(" 路 ")
    : "";

  let mainHTML = "";
  if (latest) {
    mainHTML = `<div class="focus-frame-main">${escapeFocusText(truncateConclusion(latest, isTop ? 120 : 80))}</div>`;
  } else if (topicSummary) {
    mainHTML = `<div class="focus-frame-main focus-frame-main-fallback">${escapeFocusText(truncateConclusion(topicSummary, isTop ? 60 : 40))}</div>`;
  }

  const earlierHTML = earlier.map((c) =>
    `<div class="focus-frame-conclusion focus-frame-conclusion-earlier">${escapeFocusText(truncateConclusion(c, isTop ? 100 : 60))}</div>`
  ).join("");

  // 璇ュ抚鏃㈡棤 conclusion 涔熸棤 topic锛堟瀬鐭殏鐨?鍒?push 杩樻病璧?topic"鐘舵€侊級锛屼笉娓叉煋澶栧眰澹?
  if (!mainHTML && !earlierHTML) return "";

  return (
    `<div class="focus-frame${isTop ? " top" : ""}">` +
      mainHTML +
      earlierHTML +
    `</div>`
  );
}

function renderFocusStack(stack) {
  if (!focusStackEl || !focusBlockEl) return;
  const list = Array.isArray(stack) ? stack : [];
  if (focusDepthEl) focusDepthEl.textContent = String(list.length);

  if (list.length === 0) {
    focusBlockEl.dataset.state = "empty";
    focusStackEl.innerHTML = `<div class="focus-empty">鏃犱笓娉?/div>`;
    return;
  }

  focusBlockEl.dataset.state = "active";
  // 娓叉煋绛栫暐锛氬彧娓叉煋"鏈?conclusion 鐨勫抚 + 鏍堥《甯?銆?
  // 闈炴爤椤?+ 鏃?conclusion 鐨勫抚闈欓粯闅愯棌鈥斺€旇繖绉嶅抚鏄?宸?push 浣嗚繕娌?pop"鐨勬椿甯э紝
  // conclusion 姘歌繙绌虹潃锛屾覆鏌撳嚭鏉ュ彧鏄崰浣嶆枃瀛楋紙"鈥?锛夛紝鍫嗗彔澶氫簡瑙嗚寰堝櫔銆?
  // depth 鏁板瓧浠嶇劧鏄剧ず鐪熷疄鏍堟繁搴︼紝璁╃敤鎴风煡閬撹繕鏈夋湭鍘嬬缉鐨勫抚鎸傜潃銆?
  // 鏍堝簳 鈫?鏍堥《锛涜瑙変笂鏍堥《鍦ㄦ渶涓嬶紙鏈€杩戜竴娆℃渶寮猴級锛岃窡缁堢 / 鎬濊€冩祦鏂瑰悜涓€鑷淬€?
  const html = list.map((frame, i) => {
    const isTop = i === list.length - 1;
    const hasConclusion = Array.isArray(frame?.conclusions) && frame.conclusions.length > 0;
    if (!isTop && !hasConclusion) return "";
    return renderFocusFrame(frame, { isTop });
  }).filter(Boolean).join("");
  focusStackEl.innerHTML = html;
}

function flashFocusCompressed() {
  if (!focusBlockEl) return;
  // 璁╂爤椤跺抚鐨勪富琛岋紙鏈€鏂?conclusion锛夎蛋娣″叆鍔ㄧ敾锛涘悓鏃舵暣鍧楀仛涓€娆℃煍鍜岄珮鍏夈€?
  focusBlockEl.classList.remove("focus-compress-pulse");
  // 寮哄埗 reflow 璁╁姩鐢婚噸鍚?
  void focusBlockEl.offsetWidth;
  focusBlockEl.classList.add("focus-compress-pulse");

  const topFrame = focusStackEl?.querySelector(".focus-frame.top");
  const mainEl = topFrame?.querySelector(".focus-frame-main");
  if (mainEl) {
    mainEl.classList.remove("just-added");
    void mainEl.offsetWidth;
    mainEl.classList.add("just-added");
  }
}

function connectSSE() {
  setConnectionState("连接中", true);
  const es = new EventSource(`${API}/events`);

  es.onopen = () => setConnectionState("已连接", true);

  es.onmessage = event => {
    try {
      const payload = JSON.parse(event.data);
      window.dispatchEvent(new CustomEvent("xiao-dun:sse-event", { detail: payload }));
      handle(payload);
    } catch (error) {
      console.warn("[SSE] failed to handle event", error, event.data);
    }
  };

  es.onerror = () => {
    setConnectionState("重连中", false);
    es.close();
    setTimeout(connectSSE, 3000);
  };
}

function handle({ type, data = {} }) {
  // 反幻觉前端守卫：检测 agent 回复中是否含反诈模板关键词循环
  if (type === 'agent_response' && typeof data.content === 'string') {
    const hits = ['刷单返利', '冒充客服', '公检法', '投资理财', '杀猪盘', '贷款诈骗', '裸聊敲诈', '网络约炮', '虚假贷款']
      .filter(k => data.content.includes(k)).length
    if (hits >= 3) {
      appState._boilerHits = (appState._boilerHits || 0) + 1
      if (appState._boilerHits >= 3) {
        console.warn('[boilerplate-guard] 连续 3 轮检测到诈骗关键词堆砌，建议 /clear 重置对话')
        appState._boilerHits = 0
      }
    } else {
      appState._boilerHits = 0
    }
  }
  switch (type) {
    case "message_received": {
      currentPath = "l1";
      planPath = "active";
      // 鍏滃簳锛氫笂涓€杞嫢琚墦鏂€乵essage/response 鍧囨湭鍒拌揪锛屽疄鏃舵皵娉′細鎴愬鍎裤€佹祦寮忎細璇濆彲鑳借繕鎸傜潃楹﹀厠椋?
      // 鈥斺€斿畾绋挎皵娉°€佹敹灏炬祦寮忎細璇濓紙鎭㈠楹﹀厠椋庯級銆佸浣嶇姸鎬侊紝鍐嶅紑鏂颁竴杞€?
      if (chat.hasLiveJarvisMsg()) chat.finalizeLiveJarvisMsg(null);
      liveReplyActive = false;
      liveRawText = "";
      L1.beginRound();
      const parsed = parseUserMessageInput(data.input);
      L1.newLine("user message received", {
        content: parsed.content,
        time: parsed.time || undefined,
      });
      openPlanCard(parsed.content || "用户消息");
      L1.startThinkingSession();
      break;
    }
    case "tick":
      currentPath = "l2";
      L2.beginRound();
      L2.newLine("heartbeat tick");
      L2.startThinkingSession();
      break;
    case "stream_start":
      currentStream().startThinkingSession();
      // 姝ｆ枃娴侊紙plainReply锛夛細鎶?token 瀹炴椂鎵撹繘鑱婂ぉ姘旀场銆備竴杞彲鑳芥湁澶氭姝ｆ枃锛堟鏂団啋宸ュ叿鈫掓鏂囷級锛?
      // 鍙湪灏氭湭寮€濮嬫椂寤烘皵娉★紝鍚庣画娈电疮绉繘鍚屼竴涓€俿peak 杞紙璇煶锛夐澶栧紑鍚€愬彞娴佸紡鍚堟垚銆?
      if (data.mode === "text" && data.plainReply) {
        if (!liveReplyActive) {
          liveReplyActive = true;
          liveRawText = "";
          chat.beginLiveJarvisMsg({ alert: true });
        }
      }
      break;
    case "stream_chunk":
      // 鎬濊€冩祦锛氬彧椹卞姩 token 閫熺巼鎸囩ず鍣紝涓嶈繘鑱婂ぉ锛堜繚鎸?dashboard 绾噣锛?
      currentStream().clearStatus();
      bumpTokens(data.text);
      // 正文流：累积 + 实时重渲染气泡（剥离协议标记 / 藏半截标记）；语音轮喂给逐句合成队列
      if (data.mode === "text" && liveReplyActive) {
        liveRawText += data.text;
        chat.updateLiveJarvisMsg(cleanStreamText(liveRawText));
      }
      break;
    case "stream_end":
      currentStream().stopThinking();
      // 正文段结束：把残句先送去合成，降低尾句延迟（不结束会话，可能还有后续正文段）
      break;
    case "tool_preparing": {
      if (currentPath === "l1") addPlanStep(data.name);
      const stream = currentStream();
      const label = data.name ? stream.toolLabel(data.name) : "";
      stream.setStatus(label ? "准备调用 " + label + "…" : "准备工具调用…", "busy");
      break;
    }
    case "tool_executing": {
      if (currentPath === "l1") updatePlanStep(data.name, "running");
      const stream = currentStream();
      const label = data.name ? stream.toolLabel(data.name) : "工具";
      stream.setTimedStatus("正在执行 " + label + "…", "busy", {
        staleAfterMs: 45000,
        staleText: "执行 " + label + " 时间偏长，仍在等待结果…",
      });
      break;
    }
    case "tool_call":
      if (currentPath === "l1") updatePlanStep(data.name, data.ok ? "done" : "failed");
      currentStream().tool(data.name, data.args, data.result, data.ok);
      recordAiActivity(data.name);
      break;
    case "response":
      // Round complete — stop all animations
      if (currentPath === "l1") closePlanCard();
      planPath = "idle";
      currentStream().end();
      // 鍏滃簳锛氭湰杞粨鏉熸椂锛坮esponse 蹇呭湪 message 涔嬪悗鍙戯級鑻ユ祦寮忓悎鎴愪細璇濅粛寮€鐫€鈥斺€旀瀬灏戣锛屾ā鍨嬪彧璋冧簡宸ュ叿
      // 娌′骇鍑哄彲鎶曢€掓鏂囥€乵essage 鏈埌杈锯€斺€旀爣璁版鏂囧凡灏借闃熷垪鏀惧畬鍗虫仮澶嶉害鍏嬮锛岄伩鍏嶉害鍏嬮涓€鐩存寕璧枫€?
      // 姝ｅ父鎯呭喌 message 宸?finalize 杩囷紝姝ゅ骞傜瓑鏃犲壇浣滅敤锛屼笉浼氭墦鏂粛鍦ㄦ挱鏀剧殑灏惧彞銆?
      if (chat.hasLiveJarvisMsg()) chat.finalizeLiveJarvisMsg(null);
      break;
    case "processing_preempted":
      currentStream().end();
      break;
    case "llm_retry": {
      currentStream().startThinkingSession();
      const nextAttempt = Number(data.nextAttempt || 2);
      const delayText = formatRetryDelay(Number(data.delayMs || 0));
      currentStream().setStatus("LLM 繁忙，第 " + nextAttempt + " 次重试将在 " + delayText + " 后开始", "busy");
      break;
    }
    case "message_requeued": {
      currentStream().startThinkingSession();
      const retryCount = Number(data.retryCount || 1);
      currentStream().setStatus("LLM 繁忙，已入队重试 " + retryCount + "/3", "busy");
      break;
    }
    case "message_dropped":
      currentStream().startThinkingSession();
      currentStream().setStatus("LLM 繁忙，重试次数已达上限", "failed");
      break;
    case "error":
      if (isBusyErrorMessage(data.error)) {
        currentStream().startThinkingSession();
        currentStream().setStatus("LLM 繁忙，请稍后重试", "busy");
      } else {
        currentStream().stopThinking();
        currentStream().setStatus(data.error || "处理失败", "failed");
      }
      break;
    case "protocol_violation":
      currentStream().end();
      break;
    case "focus_frame": {
      renderFocusStack(data.focusStack);
      break;
    }
    case "focus_compressed": {
      // 鍚庣 emit 椤哄簭锛氬厛 focus_frame锛堟爤宸?pop 瀹岋級鈫?寮傛鍘嬬缉瀹屽啀 focus_compressed銆?
      // 瑙﹀彂鏃舵爤椤跺抚鐨?conclusions 鏁扮粍鍦ㄥ悗绔凡琚拷鍔狅紝浣嗗墠绔?DOM 閲岃繕鏄棫鐨勩€?
      // 鏂板竷灞€锛氭妸鏂?conclusion 鍐欏叆銆屼富琛屻€?.focus-frame-main)锛?
      // 鑻ヤ富琛屽師鏈槸 fallback锛堟殏鏃犳矇娣€缁撹锛夛紝灏辨妸瀹冨崌绾т负姝ｅ父涓昏銆?
      // 鑻ヤ富琛屽凡鏈夋棫 conclusion锛屾妸鏃у€奸檷绾ц拷鍔犲埌銆屾棭鏈?conclusion銆嶅垪琛ㄩ噷锛屽啀瑕嗙洊涓昏銆?
      // 涓嬩竴娆?focus_frame 浜嬩欢浼氬甫鏈€鏂?conclusions 鍏ㄩ噺瑕嗙洊锛屾墍浠ュ嵆浣块敊浣嶄篃寰堝揩鏀舵暃銆?
      const topFrame = focusStackEl?.querySelector(".focus-frame.top");
      if (topFrame && data.conclusion) {
        const mainEl = topFrame.querySelector(".focus-frame-main");
        const newText = truncateConclusion(data.conclusion, 120);
        if (mainEl) {
          const wasFallback = mainEl.classList.contains("focus-frame-main-fallback");
          if (!wasFallback && mainEl.textContent) {
            const earlier = document.createElement("div");
            earlier.className = "focus-frame-conclusion focus-frame-conclusion-earlier";
            earlier.textContent = mainEl.textContent;
            topFrame.appendChild(earlier);
          }
          mainEl.classList.remove("focus-frame-main-fallback");
          mainEl.innerHTML = "";
          mainEl.textContent = newText;
        }
      }
      flashFocusCompressed();
      break;
    }
    case "message": {
      // The delivery layer has historically used `from: consciousness` + `content`,
      // while adapters may use role/message/text. Normalize all supported shapes
      // before touching the chat renderer so a successful tool delivery is visible.
      if (!isAssistantMessageEvent(data)) break;
      const rawContent = extractAssistantMessageContent(data);
      if (!rawContent) break;
      const viaLabel = friendlyChannelLabel(data.channel);
      const content = viaLabel ? `_\u2192${viaLabel}_  \n${rawContent}` : rawContent;
      const messageId = resolveAssistantMessageId(data);
      lastJarvisContent = rawContent;

      if (chat.hasLiveJarvisMsg()) {
        const finalized = chat.finalizeLiveJarvisMsg(content, {
          messageId,
          source: "event",
        });
        // A stale in-memory de-duplication entry must never make a real
        // assistant reply disappear. If the message is not in the DOM, render it.
        if (!finalized && !chat.hasRenderedMessage(messageId)) {
          addMsg("jarvis", content, { messageId, source: "event", dedupe: false });
        }
      } else {
        addMsg("jarvis", content, { messageId, source: "event" });
      }
      liveReplyActive = false;
      liveRawText = "";
      openChat(true);
      break;
    }
    case "message_in": {
      // 外部渠道判定：channel 非空且非本地，或 from_id 仍带外部前缀（兼容连接器直接 emit 的事件）
      const ch = String(data.channel || "").toUpperCase();
      const isExternal =
        (ch && ch !== "TUI" && ch !== "API" && ch !== "SYSTEM" && ch !== "REMINDER" && ch !== "APP_SIGNAL" && ch !== "VOICE" && ch !== "语音识别")
        || (data.from_id && /^(wechat|discord|feishu|wecom):/i.test(data.from_id));
      if (isExternal) {
        const label = friendlyChannelLabel(data.channel) || data.from_id || "External";
        addMsg("external", data.content, { label, alert: false, messageId: data.conversation_id || data.conversationId || "" });
        openChat(true);
      }
      break;
    }
    case "agent_name_updated":
      setAgentName(data.name);
      break;
    case "media_mode":
      window.dispatchEvent(new CustomEvent("xiaodun:media", { detail: data }));
      break;
    case "hotspot_mode":
      if (!!data.active || data.action === "show" || data.action === "open") ragManager?.close();
      setHotspotMode(!!data.active || data.action === "show" || data.action === "open", { source: "agent_event" });
      break;

    case "doc_panel_mode":
      setDocPanelMode(!!data.active || data.action === "open", { topicId: data.topic || null, source: "agent_event" });
      break;
    case "social_status":
      window.dispatchEvent(new CustomEvent("xiaodun:social_status", { detail: data }));
      break;
    case "show_wechat_popup":
      showWechatPopup();
      break;
    case "show_feishu_popup":
      showFeishuPopup();
      break;
    case "key_configured":
      chat.deleteLastUserMsg();
      break;
    case "fraud_intel_update": {
      // 诈骗情报定时采集发现新案例，主动推送给用户
      const cases = data.cases || [];
      if (cases.length === 0) break;
      const lines = ["【反诈情报更新】检测到 " + data.new_count + " 条新诈骗案例："];
      cases.forEach((c, i) => {
        lines.push("");
        lines.push((i + 1) + ". [" + c.type + "] " + c.title);
        if (c.summary) lines.push("   " + c.summary.slice(0, 150));
        if (c.source) lines.push("   来源：" + c.source);
      });
      lines.push("");
      lines.push("请留意以上新型诈骗手法，保护好个人信息和资金安全。");
      addMsg("jarvis", lines.join("\n"), { source: "fraud_intel" });
      openChat(true);
      break;
    }
    default:
      break;
  }
}

resetViewBtn?.addEventListener("click", resetZoom);

document.querySelectorAll(".panel, .console, .theme-switcher, .reset-view").forEach(el => {
  el.addEventListener("wheel", event => event.stopPropagation(), { passive: true });
});


setAgentName(DEFAULT_AGENT_NAME);
initUiZoom();
chat = initChat({
  apiBase: API,
  maxHistory: MAX_CHAT_HISTORY,
  activationWarmupKey: ACTIVATION_WARMUP_KEY,
  getAgentName: () => agentName,
  defaultInputPlaceholder,
  openSettings: (tab) => openSettingsRef?.(tab),
  openHotspot: () => {
    ragManager?.close();
    setHotspotMode(true);
  },
  openRagManager: () => ragManager?.open(),
});
ragManager = initRagManager({
  openChat: () => chat?.openChat(),
  closeHotspot: () => setHotspotMode(false),
});
chat.applyActivationWarmupLock();
connectSSE();
loadAgentProfile();
initDocPanel().catch((err) => console.warn('[DocPanel] init failed:', err));
chat.restoreChatHistory();
chat.unlockAudioOnFirstGesture();

bootstrapScene();  // Scene 鏋舵瀯 shell(/scene):澹版槑寮?Agent-UI 鎶曞奖灞傘€?
initNarrowScreenPanelDefaults();
initPanelCollapse();
initCrossMenuButton();
initWechatPopup();
initFeishuPopup();

/**
 * 窄屏下左右面板是覆盖式抽屉，默认展开会盖住地图与对话框，
 * 因此进入窄屏时强制收起两侧面板；用户仍可用左上/右上角的 tab 按钮随时召出。
 *
 * 必须在 initPanelCollapse() 之前调用：initPanelCollapse 只会按 localStorage
 * 追加 collapsed 类、不会移除，所以这里预置的收起状态会被保留。
 */
function initNarrowScreenPanelDefaults() {
  // 窄屏断点：与 styles.css 中面板抽屉化的媒体查询保持一致
  const NARROW_SCREEN_QUERY = "(max-width: 780px)";
  const mediaQuery = window.matchMedia?.(NARROW_SCREEN_QUERY);
  if (!mediaQuery) return;

  const collapseBothPanels = (query) => {
    if (!query.matches) return;
    document.body.classList.add("l1-collapsed", "l2-collapsed");
  };

  collapseBothPanels(mediaQuery);
  // 桌面 → 窄屏的实时缩放同样需要收起，避免抽屉盖住对话框
  mediaQuery.addEventListener?.("change", collapseBothPanels);
}

/**
 * 对话框左下角"十字架"按钮：调出与输入 "/" 完全一致的命令列表。
 * 列表内容、样式与执行路径全部复用 chat.js 内的斜杠命令实现。
 */
function initCrossMenuButton() {
  const crossBtn = document.getElementById("cross-menu-btn");
  if (!crossBtn) return;

  // 用 mousedown（与 .slash-item 一致）抢在输入框 blur 之前触发，避免菜单被 blur 关掉
  crossBtn.addEventListener("mousedown", (event) => {
    event.preventDefault();
    chat?.openSlashMenuFromButton?.();
  });

  // 键盘可达性：Tab 聚焦后 Enter / Space 也能打开
  crossBtn.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    chat?.openSlashMenuFromButton?.();
  });
}

// 鈹€鈹€ Settings modal 鈹€鈹€
(function initSettings() {
  const settingsBtn     = document.getElementById("settings-btn");
  const overlay         = document.getElementById("settings-overlay");
  const closeBtn        = document.getElementById("settings-close");
  const providerSelect  = document.getElementById("settings-provider-select");
  const modelSelect     = document.getElementById("settings-model-select");
  const officialCustomModelInput = document.getElementById("settings-official-custom-model");
  const llmKeyInput     = document.getElementById("settings-llm-key");
  const llmKeyToggle    = document.getElementById("settings-llm-key-toggle");
  const saveLlmBtn      = document.getElementById("settings-save-llm");
  const llmFeedback     = document.getElementById("settings-llm-feedback");
  const agentNameInput  = document.getElementById("settings-agent-name");
  const saveAgentNameBtn = document.getElementById("settings-save-agent-name");
  const agentNameFeedback = document.getElementById("settings-agent-name-feedback");
  const tempSlider      = document.getElementById("settings-temperature");
  const tempVal         = document.getElementById("settings-temperature-val");
  const saveTempBtn     = document.getElementById("settings-save-temperature");
  const tempFeedback    = document.getElementById("settings-temperature-feedback");
  const thinkingToggle  = document.getElementById("settings-thinking");
  const thinkingFeedback = document.getElementById("settings-thinking-feedback");
  const minimaxKeyInput = document.getElementById("settings-minimax-key");
  const saveMinimaxBtn  = document.getElementById("settings-save-minimax");
  const minimaxFeedback = document.getElementById("settings-minimax-feedback");
  const saveSocialBtn   = document.getElementById("settings-save-social");
  const socialFeedback  = document.getElementById("settings-social-feedback");
  const saveVoiceBtn    = document.getElementById("settings-save-voice");
  const voiceFeedback   = document.getElementById("settings-voice-feedback");
  const voiceThreshSlider = document.getElementById("settings-voice-threshold");
  const voiceThreshVal    = document.getElementById("settings-voice-threshold-val");
  const voiceMicSelect    = document.getElementById("voice-mic-select");
  const voiceRefreshMicsBtn = document.getElementById("voice-refresh-mics");
  const voiceMicStatus    = document.getElementById("voice-mic-status");
  const volcAsrKeyInput      = document.getElementById("voice-volc-apikey");
  const volcAsrKeyToggle     = document.getElementById("voice-volc-apikey-toggle");
  const mapKeyInput          = document.getElementById("settings-amap-key");
  const mapSecurityInput     = document.getElementById("settings-amap-security");
  const saveMapBtn           = document.getElementById("settings-save-map");
  const clearMapBtn          = document.getElementById("settings-clear-map");
  const mapFeedback          = document.getElementById("settings-map-feedback");

  if (!settingsBtn || !overlay) return;

  let cachedProviders = null;
  let cachedLlm = null;
  let llmKeyVisible = false;
  let volcAsrKeyVisible = false;
  let volcAsrSaveTimer = null;
  let volcAsrSaveRequest = 0;
  const agentNameRe = /^[\p{L}\p{N} _-]+$/u;
  const CUSTOM_MODEL_VALUE = "__custom_model__";

  overlay.querySelectorAll(".settings-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      overlay.querySelectorAll(".settings-nav-item").forEach(b => b.classList.remove("active"));
      overlay.querySelectorAll(".settings-tab").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      overlay.querySelector(`.settings-tab[data-tab="${tab}"]`)?.classList.add("active");
      if (tab === "social") loadSocialSettings();
      if (tab === "security") loadSecuritySettings();
      if (tab === "web-search") loadWebSearchSettings();
      if (tab === "advanced") loadMapSettings();
    });
  });

  function showFeedback(el, msg, isError = false) {
    if (!el) return;
    el.textContent = msg;
    el.className = "settings-feedback" + (isError ? " error" : "");
    setTimeout(() => { el.textContent = ""; el.className = "settings-feedback"; }, 3000);
  }

  function refreshConfigSummary({ llm, minimax }) {
    const cfgLlm = document.getElementById("settings-cfg-llm");
    const cfgLlmDot = document.getElementById("settings-cfg-llm-dot");
    const cfgMedia = document.getElementById("settings-cfg-media");
    const cfgMediaDot = document.getElementById("settings-cfg-media-dot");
    if (cfgLlm) cfgLlm.textContent = String(llm.provider || "-") + " / " + String(llm.model || "-");
    if (cfgLlmDot) {
      cfgLlmDot.textContent = "●";
      cfgLlmDot.className = `settings-config-dot ${llm.activated ? "active" : "inactive"}`;
      cfgLlmDot.title = llm.activated ? "Running" : "Inactive";
    }
    if (cfgMedia) cfgMedia.textContent = `minimax 路 ${minimax.configured ? "configured" : "not configured"}`;
    if (cfgMediaDot) {
      cfgMediaDot.textContent = "●";
      cfgMediaDot.className = `settings-config-dot ${minimax.configured ? "active" : "inactive"}`;
    }
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function syncOfficialCustomModelRow() {
    const customRow = document.getElementById("settings-official-custom-model-row");
    if (!customRow || !modelSelect) return;
    customRow.style.display = modelSelect.value === CUSTOM_MODEL_VALUE ? "" : "none";
  }

  function populateModelSelect(models, current) {
    if (!modelSelect || !models) return;
    const list = Array.isArray(models) ? models.filter(m => m?.id) : [];
    const currentModel = String(current || "").trim();
    const hasCurrent = currentModel && list.some(m => m.id === currentModel);
    modelSelect.innerHTML = list
      .map(m => `<option value="${escapeHtml(m.id)}"${m.deprecated ? " data-deprecated" : ""}>${escapeHtml(m.label || m.id)}</option>`)
      .concat(`<option value="${CUSTOM_MODEL_VALUE}">手动输入模型名称</option>`)
      .join("");
    if (hasCurrent) {
      modelSelect.value = currentModel;
      if (officialCustomModelInput) officialCustomModelInput.value = "";
    } else if (currentModel) {
      modelSelect.value = CUSTOM_MODEL_VALUE;
      if (officialCustomModelInput) officialCustomModelInput.value = currentModel;
    }
    syncOfficialCustomModelRow();
  }

  function populateProviderSelect(providers, current) {
    if (!providerSelect || !providers) return;
    const selected = current || providerSelect.value || "auto";
    const options = [`<option value="auto">Auto-detect</option>`]
      .concat(Object.entries(providers).map(([id, provider]) => {
        const label = provider.label || id;
        return `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`;
      }));
    providerSelect.innerHTML = options.join("");
    providerSelect.value = providers[selected] || selected === "auto" ? selected : "auto";
  }

  function setLlmKeyVisible(visible) {
    llmKeyVisible = Boolean(visible);
    if (llmKeyInput) llmKeyInput.type = llmKeyVisible ? "text" : "password";
    if (llmKeyToggle) {
      llmKeyToggle.setAttribute("aria-label", llmKeyVisible ? "隐藏 API Key" : "显示 API Key");
      llmKeyToggle.title = llmKeyVisible ? "隐藏 API Key" : "显示 API Key";
    }
  }

  function getProviderConfigForUI(provider, llm = cachedLlm) {
    const summary = cachedProviders?.[provider] || {};
    if (llm && provider === llm.provider) {
      return {
        ...summary,
        ...llm,
        apiKey: llm.apiKey ?? summary.apiKey ?? "",
      };
    }
    return summary;
  }

  function applyCustomProviderUI(providerOrLlm) {
    const provider = typeof providerOrLlm === "string"
      ? providerOrLlm
      : (providerOrLlm?.provider || "auto");
    const providerCfg = getProviderConfigForUI(provider, typeof providerOrLlm === "object" ? providerOrLlm : cachedLlm);
    const customSection = document.getElementById("settings-custom-llm-section");
    const modelRow = document.getElementById("settings-model-row");
    const officialCustomModelRow = document.getElementById("settings-official-custom-model-row");
    if (provider === "auto") {
      if (customSection) customSection.style.display = "none";
      if (modelRow) modelRow.style.display = "none";
      if (officialCustomModelRow) officialCustomModelRow.style.display = "none";
      if (llmKeyInput) llmKeyInput.value = "";
      setLlmKeyVisible(false);
      return;
    }
    if (provider === "custom") {
      if (customSection) customSection.style.display = "";
      if (modelRow) modelRow.style.display = "none";
      if (officialCustomModelRow) officialCustomModelRow.style.display = "none";
      const baseUrlEl = document.getElementById("settings-custom-baseurl");
      const modelEl = document.getElementById("settings-custom-model");
      if (baseUrlEl) baseUrlEl.value = providerCfg.baseURL || "";
      if (modelEl) modelEl.value = providerCfg.model || "";
    } else {
      if (customSection) customSection.style.display = "none";
      if (modelRow) modelRow.style.display = "";
      if (cachedProviders?.[provider]) {
        populateModelSelect(
          cachedProviders[provider].models,
          providerCfg.model || cachedProviders[provider].defaultModel,
        );
      }
    }
    if (llmKeyInput) llmKeyInput.value = providerCfg.apiKey || "";
    setLlmKeyVisible(false);
  }

  async function loadSettings() {
    try {
      const data = await fetch(`${API}/settings`).then(r => r.json());
      const { llm, minimax, providers } = data;
      if (providers) cachedProviders = providers;
      cachedLlm = llm;
      if (agentNameInput) agentNameInput.value = data.agent_name || agentName || DEFAULT_AGENT_NAME;
      refreshConfigSummary({ llm, minimax });
      refreshLlmProviderName();
      populateProviderSelect(providers, llm.provider || "auto");
      if (providerSelect && llm.provider) providerSelect.value = llm.provider;
      applyCustomProviderUI(llm);
      if (typeof llm.temperature === "number" && tempSlider) {
        tempSlider.value = String(llm.temperature);
        if (tempVal) tempVal.textContent = llm.temperature.toFixed(2);
      }
      if (thinkingToggle) thinkingToggle.checked = llm.thinking === true;
    } catch {}
  }

  const SOCIAL_FIELD_MAP = {
    "social-discord-token":  "DISCORD_BOT_TOKEN",
    "social-feishu-appid":   "FEISHU_APP_ID",
    "social-feishu-secret":  "FEISHU_APP_SECRET",
    "social-feishu-token":   "FEISHU_VERIFICATION_TOKEN",
    "social-wechat-appid":   "WECHAT_OFFICIAL_APP_ID",
    "social-wechat-secret":  "WECHAT_OFFICIAL_APP_SECRET",
    "social-wechat-token":   "WECHAT_OFFICIAL_TOKEN",
    "social-wecom-botkey":   "WECOM_BOT_KEY",
    "social-wecom-token":    "WECOM_INCOMING_TOKEN",
  };

  const SOCIAL_PLATFORM_STATUS = {
    "social-status-discord": ["DISCORD_BOT_TOKEN"],
    "social-status-feishu":  ["FEISHU_APP_ID", "FEISHU_APP_SECRET", "FEISHU_VERIFICATION_TOKEN"],
    "social-status-wechat":  ["WECHAT_OFFICIAL_APP_ID", "WECHAT_OFFICIAL_APP_SECRET", "WECHAT_OFFICIAL_TOKEN"],
    "social-status-wecom":   ["WECOM_BOT_KEY", "WECOM_INCOMING_TOKEN"],
  };

  async function loadSocialSettings() {
    try {
      const { social } = await fetch(`${API}/settings/social`).then(r => r.json());
      for (const [statusId, keys] of Object.entries(SOCIAL_PLATFORM_STATUS)) {
        const el = document.getElementById(statusId);
        if (!el) continue;
        const configuredCount = keys.filter(k => social[k]?.configured).length;
        if (configuredCount === keys.length) {
          el.textContent = "● 已配置";
          el.className = "settings-platform-status ok";
        } else if (configuredCount > 0) {
          el.textContent = `○ 部分配置 (${configuredCount}/${keys.length})`;
          el.className = "settings-platform-status miss";
        } else {
          el.textContent = "○ 未配置";
          el.className = "settings-platform-status miss";
        }
      }
    } catch {}
  }

  const fileSandboxToggle = document.getElementById("security-file-sandbox");
  const execSandboxToggle = document.getElementById("security-exec-sandbox");
  const lanAccessToggle   = document.getElementById("security-lan-access");
  const saveSecurityBtn   = document.getElementById("settings-save-security");
  const restartSecurityBtn = document.getElementById("settings-restart-security");
  const securityFeedback  = document.getElementById("settings-security-feedback");

  async function loadWebSearchSettings() {
    try {
      const { webSearch } = await fetch(`${API}/settings/web-search`).then(r => r.json());
      const urlEl = document.getElementById("websearch-searxng-url");
      if (urlEl) urlEl.value = webSearch?.searxngUrl || "";
      const setStatus = (id, configured, fromEnv, extra) => {
        const el = document.getElementById(id);
        if (!el) return;
        const truncated = extra && extra.length > 60 ? extra.slice(0, 60) + "…" : extra;
        if (configured) {
          el.textContent = `已配置${fromEnv ? "（环境变量）" : ""}${truncated ? ` · ${truncated}` : ""}`;
          el.style.color = "var(--ok, #4caf50)";
        } else {
          el.textContent = "未配置（兜底链中跳过）";
          el.style.color = "var(--ink2)";
        }
      };
      setStatus("websearch-status-serper",  !!webSearch?.serperConfigured, !!webSearch?.serperFromEnv);
      setStatus("websearch-status-brave",   !!webSearch?.braveConfigured,  !!webSearch?.braveFromEnv);
      setStatus("websearch-status-tavily",  !!webSearch?.tavilyConfigured, !!webSearch?.tavilyFromEnv);
      setStatus("websearch-status-jina",    !!webSearch?.jinaConfigured,   !!webSearch?.jinaFromEnv);
      const searxngConfigured = !!webSearch?.searxngUrl || !!webSearch?.searxngFromEnv;
      setStatus("websearch-status-searxng", searxngConfigured, !!webSearch?.searxngFromEnv, webSearch?.effectiveSearxngUrl || "");
    } catch {}
  }

  const saveWebSearchBtn = document.getElementById("settings-save-web-search");
  const webSearchFeedback = document.getElementById("settings-web-search-feedback");
  if (saveWebSearchBtn) {
    saveWebSearchBtn.addEventListener("click", async () => {
      const updates = {};
      const serperEl  = document.getElementById("websearch-serper-key");
      const braveEl   = document.getElementById("websearch-brave-key");
      const tavilyEl  = document.getElementById("websearch-tavily-key");
      const jinaEl    = document.getElementById("websearch-jina-key");
      const searxngEl = document.getElementById("websearch-searxng-url");
      const serperVal  = serperEl?.value?.trim();
      const braveVal   = braveEl?.value?.trim();
      const tavilyVal  = tavilyEl?.value?.trim();
      const jinaVal    = jinaEl?.value?.trim();
      const searxngVal = searxngEl?.value?.trim();
      if (serperVal)  updates.serperKey  = serperVal;
      if (braveVal)   updates.braveKey   = braveVal;
      if (tavilyVal)  updates.tavilyKey  = tavilyVal;
      if (jinaVal)    updates.jinaKey    = jinaVal;
      // SearXNG URL锛氱┖瀛楃涓蹭篃瑕佷紶锛岃鐢ㄦ埛鑳芥竻鎺?
      if (searxngEl)  updates.searxngUrl = searxngVal || "";
      saveWebSearchBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/web-search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(webSearchFeedback, "已保存");
          if (serperEl) serperEl.value = "";
          if (braveEl)  braveEl.value = "";
          if (tavilyEl) tavilyEl.value = "";
          if (jinaEl)   jinaEl.value = "";
          loadWebSearchSettings();
        } else {
          showFeedback(webSearchFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(webSearchFeedback, "请求失败", true);
      } finally {
        saveWebSearchBtn.disabled = false;
      }
    });
  }

  async function loadSecuritySettings() {
    try {
      const { security, network } = await fetch(`${API}/settings/security`).then(r => r.json());
      if (fileSandboxToggle) fileSandboxToggle.checked = security.fileSandbox !== false;
      if (execSandboxToggle) execSandboxToggle.checked = security.execSandbox !== false;
      if (lanAccessToggle) lanAccessToggle.checked = network?.allowLanAccess === true;
      restartSecurityBtn?.classList.add("hidden");
      document.querySelectorAll(".security-blocked-tool").forEach(cb => {
        cb.checked = (security.blockedTools || []).includes(cb.value);
      });
    } catch {}
  }

  if (saveSecurityBtn) {
    saveSecurityBtn.addEventListener("click", async () => {
      const blockedTools = [...document.querySelectorAll(".security-blocked-tool")]
        .filter(cb => cb.checked)
        .map(cb => cb.value);
      const body = {
        fileSandbox: fileSandboxToggle ? fileSandboxToggle.checked : true,
        execSandbox: execSandboxToggle ? execSandboxToggle.checked : true,
        allowLanAccess: lanAccessToggle ? lanAccessToggle.checked : false,
        blockedTools,
      };
      saveSecurityBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/security`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.ok) {
          if (data.network?.restartRequired) {
            showFeedback(securityFeedback, "已保存，重启后生效");
            restartSecurityBtn?.classList.remove("hidden");
          } else {
            showFeedback(securityFeedback, "已保存，立即生效");
          }
        } else {
          showFeedback(securityFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(securityFeedback, "请求失败", true);
      } finally {
        saveSecurityBtn.disabled = false;
      }
    });
  }

  if (restartSecurityBtn) {
    restartSecurityBtn.addEventListener("click", async () => {
      restartSecurityBtn.disabled = true;
      try {
        await fetch(`${API}/admin/restart`, { method: "POST" });
        showFeedback(securityFeedback, "正在重启…");
      } catch {
        showFeedback(securityFeedback, "重启请求失败，请手动重启应用", true);
        restartSecurityBtn.disabled = false;
      }
    });
  }

  if (saveSocialBtn) {
    saveSocialBtn.addEventListener("click", async () => {
      const updates = {};
      for (const [fieldId, envKey] of Object.entries(SOCIAL_FIELD_MAP)) {
        const val = document.getElementById(fieldId)?.value?.trim() || "";
        if (val) updates[envKey] = val;
      }
      saveSocialBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/social`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(socialFeedback, "已保存");
          Object.keys(SOCIAL_FIELD_MAP).forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
          });
          loadSocialSettings();
        } else {
          showFeedback(socialFeedback, data.error || "保存失败", true);
        }
      } catch {
        showFeedback(socialFeedback, "请求失败", true);
      } finally {
        saveSocialBtn.disabled = false;
      }
    });
  }

  if (tempSlider && tempVal) {
    tempSlider.addEventListener("input", () => {
      tempVal.textContent = parseFloat(tempSlider.value).toFixed(2);
    });
  }
  if (saveTempBtn) {
    saveTempBtn.addEventListener("click", async () => {
      const temperature = parseFloat(tempSlider?.value ?? "0.5");
      saveTempBtn.disabled = true;
      try {
        const res = await fetch(`${API}/settings/temperature`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ temperature }),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(tempFeedback, `已设置为 ${data.temperature.toFixed(2)}`);
        } else {
          showFeedback(tempFeedback, data.error || "保存失败", true);
        }
      } catch { showFeedback(tempFeedback, "请求失败", true); }
      finally { saveTempBtn.disabled = false; }
    });
  }

  if (thinkingToggle) {
    thinkingToggle.addEventListener("change", async () => {
      const thinking = thinkingToggle.checked;
      thinkingToggle.disabled = true;
      try {
        const res = await fetch(`${API}/settings/thinking`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ thinking }),
        });
        const data = await res.json();
        if (data.ok) {
          showFeedback(thinkingFeedback, data.thinking ? "已开启，下一轮生效" : "已关闭，下一轮生效");
        } else {
          thinkingToggle.checked = !thinking;
          showFeedback(thinkingFeedback, data.error || "保存失败", true);
        }
      } catch {
        thinkingToggle.checked = !thinking;
        showFeedback(thinkingFeedback, "请求失败", true);
      } finally { thinkingToggle.disabled = false; }
    });
  }

  const VOICE_LANG_KEY       = "xiaodun-voice-lang";
  const VOICE_AUTO_SEND_KEY  = "xiaodun-voice-auto-send";
  const VOICE_AUTO_MIC_KEY   = "xiaodun-voice-auto-mic";
  const VOICE_THRESHOLD_KEY  = "xiaodun-voice-threshold";
  const VOICE_PROVIDER_KEY   = "xiaodun-voice-provider";
  const VOICE_MIC_DEVICE_KEY = "xiaodun-voice-mic-device-id";

  function applyVoiceProviderUI(provider) {
    const panels = {
      aliyun: "voice-cred-aliyun",
      volcengine: "voice-cred-volcengine",
      tencent: "voice-cred-tencent",
      xunfei: "voice-cred-xunfei",
      local: null,
    };
    for (const [key, id] of Object.entries(panels)) {
      if (!id) continue;
      const el = document.getElementById(id);
      if (el) el.style.display = key === provider ? "" : "none";
    }
  }

  function detectVoiceProviderFromKey(key) {
    const value = (key || "").trim();
    if (!value) return null;
    if (/^sk-[A-Za-z0-9_\-.]{20,}$/.test(value)) {
      return { provider: "aliyun", label: "阿里云 ASR", fieldId: "voice-aliyun-key" };
    }
    if (/^AKID/i.test(value)) {
      return { provider: "tencent", label: "腾讯云 ASR", fieldId: "voice-tencent-sid" };
    }
    if (/^\d{6,10}$/.test(value)) {
      return { provider: "xunfei", label: "科大讯飞", fieldId: "voice-xunfei-appid" };
    }
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return {
        provider: "volcengine",
        label: "火山豆包 ASR",
        fieldId: "voice-volc-apikey",
      };
    }
    return null;
  }

  function setVoiceMicStatus(message, isError = false) {
    if (!voiceMicStatus) return;
    voiceMicStatus.textContent = message;
    voiceMicStatus.style.color = isError ? "var(--warm)" : "var(--dim)";
  }

  async function loadMicrophoneDevices({ requestPermission = false } = {}) {
    if (!voiceMicSelect) return;
    if (!navigator.mediaDevices?.enumerateDevices) {
      voiceMicSelect.disabled = true;
      setVoiceMicStatus("当前环境不支持麦克风设备枚举，将使用系统默认麦克风。", true);
      return;
    }

    const savedDeviceId = localStorage.getItem(VOICE_MIC_DEVICE_KEY) || "";
    const preferredDeviceId = voiceMicSelect.value || savedDeviceId;
    let permissionError = null;

    voiceMicSelect.disabled = true;
    if (voiceRefreshMicsBtn) voiceRefreshMicsBtn.disabled = true;

    try {
      if (requestPermission && navigator.mediaDevices.getUserMedia) {
        try {
          const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          permissionStream.getTracks().forEach(track => track.stop());
        } catch (err) {
          permissionError = err;
        }
      }

      const devices = (await navigator.mediaDevices.enumerateDevices())
        .filter(device => device.kind === "audioinput");

      voiceMicSelect.innerHTML = "";
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = "系统默认麦克风";
      voiceMicSelect.appendChild(defaultOption);

      devices.forEach((device, index) => {
        const option = document.createElement("option");
        option.value = device.deviceId;
        option.textContent = device.label || "麦克风 " + (index + 1);
        voiceMicSelect.appendChild(option);
      });

      const selectedStillExists = !preferredDeviceId || devices.some(device => device.deviceId === preferredDeviceId);
      voiceMicSelect.value = selectedStillExists ? preferredDeviceId : "";
      if (!selectedStillExists && savedDeviceId) localStorage.removeItem(VOICE_MIC_DEVICE_KEY);

      const hasLabels = devices.some(device => device.label);
      if (permissionError) {
        setVoiceMicStatus("未获得麦克风权限，仍可使用系统默认麦克风；点击刷新可重新授权。", true);
      } else if (!devices.length) {
        setVoiceMicStatus("未检测到独立麦克风，将使用系统默认麦克风。");
      } else if (!hasLabels) {
        setVoiceMicStatus("已检测到 " + devices.length + " 个麦克风；点击刷新并授权后可显示完整名称。");
      } else {
        setVoiceMicStatus("已检测到 " + devices.length + " 个麦克风。更换后重新开启语音对话生效。");
      }
    } catch {
      setVoiceMicStatus("麦克风列表读取失败，将使用系统默认麦克风。", true);
    } finally {
      voiceMicSelect.disabled = false;
      if (voiceRefreshMicsBtn) voiceRefreshMicsBtn.disabled = false;
    }
  }



  const voiceProviderSelect = document.getElementById("voice-provider-select");
  if (voiceProviderSelect) {
    voiceProviderSelect.addEventListener("change", () => applyVoiceProviderUI(voiceProviderSelect.value));
  }

  const voiceAutoKey = document.getElementById("voice-auto-key");
  const voiceAutoDetect = document.getElementById("voice-auto-detect");
  if (voiceAutoKey) {
    voiceAutoKey.addEventListener("input", () => {
      const detected = detectVoiceProviderFromKey(voiceAutoKey.value);
      if (!detected) {
        if (voiceAutoDetect) voiceAutoDetect.textContent = voiceAutoKey.value.trim() ? "未识别" : "";
        return;
      }
      if (voiceProviderSelect) voiceProviderSelect.value = detected.provider;
      applyVoiceProviderUI(detected.provider);
      const target = document.getElementById(detected.fieldId);
      if (target) target.value = voiceAutoKey.value.trim();
      for (const [id, value] of Object.entries(detected.defaults || {})) {
        const el = document.getElementById(id);
        if (el && !el.value.trim()) el.value = value;
      }
      if (voiceAutoDetect) voiceAutoDetect.textContent = detected.label;
    });
  }

  async function loadMapSettings() {
    const status = document.getElementById("settings-map-status");
    const dot = document.getElementById("settings-map-status-dot");
    try {
      const data = await fetch(`${API}/settings/map`).then(r => r.json());
      const map = data?.map || {};
      if (status) {
        status.textContent = map.configured
          ? "高德地图 / 已配置"
          : "高德地图 / " + (map.keyConfigured ? "Key 已配置" : "Key 未配置") + " / 安全密钥 " + (map.securityConfigured ? "已配置" : "未配置");
      }
      if (dot) {
        dot.textContent = "●";
        dot.className = `settings-config-dot ${map.configured ? "active" : "inactive"}`;
      }
    } catch {
      if (status) status.textContent = "读取配置失败";
      if (dot) dot.className = "settings-config-dot inactive";
    }
  }

  if (saveMapBtn) {
    saveMapBtn.addEventListener("click", async () => {
      const jsKey = mapKeyInput?.value?.trim() || "";
      const securityCode = mapSecurityInput?.value?.trim() || "";
      if (!jsKey && !securityCode) {
        showFeedback(mapFeedback, "请输入 Key 或安全密钥", true);
        return;
      }
      saveMapBtn.disabled = true;
      try {
        const response = await fetch(`${API}/settings/map`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsKey, securityCode }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "保存失败");
        if (mapKeyInput) mapKeyInput.value = "";
        if (mapSecurityInput) mapSecurityInput.value = "";
        showFeedback(mapFeedback, data.map?.configured ? "地图服务已启用" : "已保存，请补全配置");
        loadMapSettings();
      } catch (err) {
        showFeedback(mapFeedback, err.message || "保存失败", true);
      } finally {
        saveMapBtn.disabled = false;
      }
    });
  }

  if (clearMapBtn) {
    clearMapBtn.addEventListener("click", async () => {
      clearMapBtn.disabled = true;
      try {
        const response = await fetch(`${API}/settings/map`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clear: true }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "清除失败");
        if (mapKeyInput) mapKeyInput.value = "";
        if (mapSecurityInput) mapSecurityInput.value = "";
        showFeedback(mapFeedback, "地图配置已清除");
        loadMapSettings();
      } catch (err) {
        showFeedback(mapFeedback, err.message || "清除失败", true);
      } finally {
        clearMapBtn.disabled = false;
      }
    });
  }

  function setVolcAsrKeyVisible(visible) {
    volcAsrKeyVisible = Boolean(visible);
    if (volcAsrKeyInput) volcAsrKeyInput.type = volcAsrKeyVisible ? "text" : "password";
    if (volcAsrKeyToggle) {
      volcAsrKeyToggle.setAttribute("aria-label", volcAsrKeyVisible ? "隐藏 API Key" : "显示 API Key");
      volcAsrKeyToggle.title = volcAsrKeyVisible ? "隐藏 API Key" : "显示 API Key";
    }
  }

  async function saveVolcAsrKeyAutomatically() {
    if (!volcAsrKeyInput) return;
    const apiKey = volcAsrKeyInput.value.trim();
    const request = ++volcAsrSaveRequest;
    try {
      const resp = await fetch(`${API}/settings/voice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceProvider: "volcengine", volcAsrApiKey: apiKey }),
      });
      if (!resp.ok) throw new Error("保存失败");
      if (request !== volcAsrSaveRequest) return;
      volcAsrKeyInput.value = apiKey;
      localStorage.setItem(VOICE_PROVIDER_KEY, "volcengine");
      showFeedback(voiceFeedback, apiKey ? "已自动保存" : "已清除");
    } catch {
      if (request === volcAsrSaveRequest) showFeedback(voiceFeedback, "自动保存失败", true);
    }
  }

  volcAsrKeyToggle?.addEventListener("click", () => {
    setVolcAsrKeyVisible(!volcAsrKeyVisible);
  });

  volcAsrKeyInput?.addEventListener("input", () => {
    if (volcAsrSaveTimer) clearTimeout(volcAsrSaveTimer);
    volcAsrSaveTimer = setTimeout(() => {
      volcAsrSaveTimer = null;
      saveVolcAsrKeyAutomatically();
    }, 500);
  });

  voiceRefreshMicsBtn?.addEventListener("click", () => {
    loadMicrophoneDevices({ requestPermission: true });
  });

  voiceMicSelect?.addEventListener("change", () => {
    setVoiceMicStatus("保存后，重新开启语音对话生效。");
  });

  navigator.mediaDevices?.addEventListener?.("devicechange", () => {
    if (!overlay.hidden) loadMicrophoneDevices();
  });

  async function loadVoiceSettings() {
    const langSelect = document.getElementById("voice-lang-select");
    const autoSend   = document.getElementById("voice-auto-send");
    if (langSelect) langSelect.value = localStorage.getItem(VOICE_LANG_KEY) || "zh-CN";
    if (autoSend) autoSend.checked = localStorage.getItem(VOICE_AUTO_SEND_KEY) !== "false";
    const autoMic = document.getElementById("voice-auto-mic");
    if (autoMic) autoMic.checked = localStorage.getItem(VOICE_AUTO_MIC_KEY) === "true";
    const savedThresh = parseFloat(localStorage.getItem(VOICE_THRESHOLD_KEY) || "0.008");
    if (voiceThreshSlider) voiceThreshSlider.value = String(savedThresh);
    if (voiceThreshVal)    voiceThreshVal.textContent = savedThresh.toFixed(3);
    await loadMicrophoneDevices();

    let savedProvider = localStorage.getItem(VOICE_PROVIDER_KEY) || "aliyun";
    try {
      const resp = await fetch(`${API}/settings/voice`);
      const data = await resp.json().catch(() => ({}));
      if (resp.ok && data?.voice?.voiceProvider) {
        savedProvider = data.voice.voiceProvider;
        localStorage.setItem(VOICE_PROVIDER_KEY, savedProvider);
      }
      const savedVolcAsrKey = data?.voice?.volcAsrApiKey?.value;
      if (volcAsrKeyInput) volcAsrKeyInput.value = typeof savedVolcAsrKey === "string" ? savedVolcAsrKey : "";
    } catch {}
    if (voiceProviderSelect) voiceProviderSelect.value = savedProvider;
    applyVoiceProviderUI(savedProvider);
  }

  if (voiceThreshSlider && voiceThreshVal) {
    voiceThreshSlider.addEventListener("input", () => {
      voiceThreshVal.textContent = parseFloat(voiceThreshSlider.value).toFixed(3);
    });
  }


  if (saveVoiceBtn) {
    saveVoiceBtn.addEventListener("click", async () => {
      const lang      = document.getElementById("voice-lang-select")?.value || "zh-CN";
      const autoSend  = document.getElementById("voice-auto-send")?.checked ?? true;
      const autoMic   = document.getElementById("voice-auto-mic")?.checked ?? false;
      const threshold = parseFloat(voiceThreshSlider?.value ?? "0.008");
      const provider  = voiceProviderSelect?.value || "aliyun";
      const micDeviceId = voiceMicSelect?.value || "";

      localStorage.setItem(VOICE_LANG_KEY,      lang);
      localStorage.setItem(VOICE_AUTO_SEND_KEY,  String(autoSend));
      localStorage.setItem(VOICE_AUTO_MIC_KEY,   String(autoMic));
      localStorage.setItem(VOICE_THRESHOLD_KEY,  String(threshold));
      if (micDeviceId) localStorage.setItem(VOICE_MIC_DEVICE_KEY, micDeviceId);
      else localStorage.removeItem(VOICE_MIC_DEVICE_KEY);

      window.dispatchEvent(new CustomEvent("xiaodun:voice-threshold", { detail: { threshold } }));
      const micLabel = voiceMicSelect?.selectedOptions?.[0]?.textContent || "系统默认麦克风";
      setVoiceMicStatus("当前麦克风：" + micLabel + "。重新开启语音对话生效。");

      const body = { voiceProvider: provider };
      const aliyunKey = document.getElementById("voice-aliyun-key")?.value?.trim();
      if (aliyunKey) body.aliyunApiKey = aliyunKey;
      const tencentSid = document.getElementById("voice-tencent-sid")?.value?.trim();
      if (tencentSid) body.tencentSecretId = tencentSid;
      const tencentSkey = document.getElementById("voice-tencent-skey")?.value?.trim();
      if (tencentSkey) body.tencentSecretKey = tencentSkey;
      const tencentAppid = document.getElementById("voice-tencent-appid")?.value?.trim();
      if (tencentAppid) body.tencentAppId = tencentAppid;
      const xunfeiAppid = document.getElementById("voice-xunfei-appid")?.value?.trim();
      if (xunfeiAppid) body.xunfeiAppId = xunfeiAppid;
      const xunfeiApikey = document.getElementById("voice-xunfei-apikey")?.value?.trim();
      if (xunfeiApikey) body.xunfeiApiKey = xunfeiApikey;
      const volcApiKey = document.getElementById("voice-volc-apikey")?.value?.trim();
      if (volcApiKey) body.volcAsrApiKey = volcApiKey;

      if (Object.keys(body).length > 0) {
        try {
          saveVoiceBtn.disabled = true;
          const resp = await fetch(`${API}/settings/voice`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data?.ok) throw new Error(data?.error || "保存失败");
          if (body.aliyunApiKey && !data?.voice?.aliyunApiKey?.configured) {
            throw new Error("阿里云 ASR API Key 未保存，请确认它来自百炼/DashScope 控制台。");
          }
          localStorage.setItem(VOICE_PROVIDER_KEY, data?.voice?.voiceProvider || provider);
          [
            "voice-aliyun-key",
            "voice-auto-key",
            "voice-tencent-sid",
            "voice-tencent-skey",
            "voice-xunfei-apikey",
          ].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = "";
          });
          if (voiceAutoDetect) voiceAutoDetect.textContent = "";
          showFeedback(voiceFeedback, "已保存");
        } catch (err) { showFeedback(voiceFeedback, err?.message || "保存失败", true); }
        finally { saveVoiceBtn.disabled = false; }
      } else {
        showFeedback(voiceFeedback, "已保存");
      }
    });
  }


  function openSettings(tab = null) {
    overlay.hidden = false;
    overlay.querySelectorAll(".theme-switcher").forEach(el => el.classList.add("visible"));
    loadSettings();
    loadVoiceSettings();
    if (tab) {
      overlay.querySelectorAll(".settings-nav-item").forEach(b => {
        b.classList.toggle("active", b.dataset.tab === tab);
      });
      overlay.querySelectorAll(".settings-tab").forEach(t => {
        t.classList.toggle("active", t.dataset.tab === tab);
      });
      if (tab === "social") loadSocialSettings();
      if (tab === "web-search") loadWebSearchSettings();
    }
  }

  function closeSettings() {
    overlay.hidden = true;
    if (llmKeyInput) llmKeyInput.value = "";
    if (minimaxKeyInput) minimaxKeyInput.value = "";
  }

  // 鏆撮湶缁?chat.js 鐨勬枩鏉犲懡浠や娇鐢?
  openSettingsRef = openSettings;

  settingsBtn.addEventListener("click", () => openSettings());
  closeBtn.addEventListener("click", closeSettings);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeSettings(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !overlay.hidden) closeSettings(); });

  if (providerSelect) {
    providerSelect.addEventListener("change", () => {
      applyCustomProviderUI(providerSelect.value);
    });
  }

  if (modelSelect) {
    modelSelect.addEventListener("change", syncOfficialCustomModelRow);
  }

  saveAgentNameBtn?.addEventListener("click", async () => {
    const nextName = agentNameInput?.value?.trim() || "";
    if (nextName.length > 32) {
      showFeedback(agentNameFeedback, "AI 名称不能超过 32 个字符", true);
      return;
    }
    if (nextName && !agentNameRe.test(nextName)) {
      showFeedback(agentNameFeedback, "AI 名称只允许中文、英文字母、数字、空格、下划线和短横线", true);
      return;
    }
    saveAgentNameBtn.disabled = true;
    try {
      const res = await fetch(`${API}/settings/agent-name`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentName: nextName }),
      });
      const data = await res.json();
      if (data.ok) {
        const savedName = data.agent_name || DEFAULT_AGENT_NAME;
        if (agentNameInput) agentNameInput.value = savedName;
        setAgentName(savedName);
        showFeedback(agentNameFeedback, "已保存");
      } else {
        showFeedback(agentNameFeedback, data.error || "保存失败", true);
      }
    } catch {
      showFeedback(agentNameFeedback, "请求失败", true);
    } finally {
      saveAgentNameBtn.disabled = false;
    }
  });

  llmKeyToggle?.addEventListener("click", () => {
    setLlmKeyVisible(!llmKeyVisible);
  });

  saveLlmBtn?.addEventListener("click", async () => {
    const provider = providerSelect?.value || "auto";
    const apiKey = llmKeyInput.value.trim();
    saveLlmBtn.disabled = true;
    try {
      const selectedCfg = cachedProviders?.[provider] || {};
      const body = { provider };
      if (provider === "custom") {
        body.baseURL = document.getElementById("settings-custom-baseurl")?.value?.trim();
        body.model = document.getElementById("settings-custom-model")?.value?.trim();
        if (!body.baseURL || !body.model) {
          showFeedback(llmFeedback, "请填写 Base URL 和模型名称", true);
          saveLlmBtn.disabled = false;
          return;
        }
        if (apiKey !== (selectedCfg.apiKey || "")) body.apiKey = apiKey || "none";
      } else if (provider === "auto") {
        if (!apiKey) {
          showFeedback(llmFeedback, "自动识别需要填写 API Key", true);
          saveLlmBtn.disabled = false;
          return;
        }
        body.apiKey = apiKey;
      } else {
        if (modelSelect.value === CUSTOM_MODEL_VALUE) {
          body.model = officialCustomModelInput?.value?.trim();
          if (!body.model) {
            showFeedback(llmFeedback, "请填写模型名称", true);
            saveLlmBtn.disabled = false;
            return;
          }
        } else {
          body.model = modelSelect.value;
        }
        if (apiKey && apiKey !== (selectedCfg.apiKey || "")) body.apiKey = apiKey;
      }

      const res = await fetch(`${API}/settings/model`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(llmFeedback, "已保存");
        loadSettings();
      } else {
        showFeedback(llmFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(llmFeedback, "请求失败", true); }
    finally { saveLlmBtn.disabled = false; }
  });

  saveMinimaxBtn?.addEventListener("click", async () => {
    const apiKey = minimaxKeyInput.value.trim();
    if (!apiKey) { showFeedback(minimaxFeedback, "API Key 涓嶈兘涓虹┖", true); return; }
    saveMinimaxBtn.disabled = true;
    try {
      const res = await fetch(`${API}/settings/minimax`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json();
      if (data.ok) {
        showFeedback(minimaxFeedback, "已保存");
        minimaxKeyInput.value = "";
        loadSettings();
      } else {
        showFeedback(minimaxFeedback, data.error || "保存失败", true);
      }
    } catch { showFeedback(minimaxFeedback, "请求失败", true); }
    finally { saveMinimaxBtn.disabled = false; }
  });

  const clawbotConnectBtn = document.getElementById("clawbot-connect-btn");
  const clawbotLogoutBtn  = document.getElementById("clawbot-logout-btn");
  const clawbotQrArea     = document.getElementById("clawbot-qr-area");
  const clawbotQrImg      = document.getElementById("clawbot-qr-img");
  const clawbotQrHint     = document.getElementById("clawbot-qr-hint");
  const clawbotFeedback   = document.getElementById("clawbot-feedback");
  const clawbotStatus     = document.getElementById("social-status-clawbot");
  let clawbotPollTimer    = null;

  function setClawbotStatus(text, ok) {
    if (!clawbotStatus) return;
    clawbotStatus.textContent = `${ok ? "●" : "○"} ${text}`;
    clawbotStatus.className = `settings-platform-status ${ok ? "ok" : "miss"}`;
  }

  function stopClawbotPoll() {
    if (clawbotPollTimer) { clearInterval(clawbotPollTimer); clawbotPollTimer = null; }
  }

  async function pollClawbotQR() {
    try {
      const data = await fetch(`${API}/social/wechat-clawbot/qr`).then(r => r.json());
      if (data.status === "connected") {
        stopClawbotPoll();
        if (clawbotQrArea) clawbotQrArea.style.display = "none";
        setClawbotStatus("已连接", true);
        if (clawbotFeedback) showFeedback(clawbotFeedback, "微信绑定成功");
        loadSocialSettings();
      } else if (data.status === "qr_ready" && data.qr_url) {
        if (clawbotQrImg) clawbotQrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qr_url)}`;
        if (clawbotQrArea) clawbotQrArea.style.display = "block";
        if (clawbotQrHint) clawbotQrHint.textContent = "等待扫码…";
        setClawbotStatus("等待扫码", false);
      } else if (data.status === "qr_pending") {
        if (clawbotQrHint) clawbotQrHint.textContent = "正在生成二维码…";
      } else if (data.status === "error") {
        stopClawbotPoll();
        if (clawbotQrArea) clawbotQrArea.style.display = "none";
        setClawbotStatus("连接失败", false);
        if (clawbotFeedback) showFeedback(clawbotFeedback, data.error || "连接失败", true);
      }
    } catch {}
  }

  if (clawbotConnectBtn) {
    pollClawbotQR();
  }

  clawbotConnectBtn?.addEventListener("click", async () => {
    if (clawbotQrArea) clawbotQrArea.style.display = "none";
    setClawbotStatus("启动中…", false);
    stopClawbotPoll();
    try {
      await fetch(`${API}/settings/social`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ _clawbot_connect: "1" }),
      });
    } catch {}
    await pollClawbotQR();
    clawbotPollTimer = setInterval(pollClawbotQR, 2000);
  });

  clawbotLogoutBtn?.addEventListener("click", async () => {
    stopClawbotPoll();
    if (clawbotQrArea) clawbotQrArea.style.display = "none";
    try {
      await fetch(`${API}/social/wechat-clawbot/logout`, { method: "POST" });
      setClawbotStatus("已断开", false);
      showFeedback(clawbotFeedback, "微信已断开");
    } catch {
      showFeedback(clawbotFeedback, "请求失败", true);
    }
  });

  window.addEventListener("xiaodun:social_status", (e) => {
    const d = e.detail;
    if (d?.platform !== "wechat-clawbot") return;
    if (d.status === "connected") {
      stopClawbotPoll();
      if (clawbotQrArea) clawbotQrArea.style.display = "none";
      setClawbotStatus("已连接", true);
    } else if (d.status === "qr_ready") {
      if (!clawbotPollTimer) clawbotPollTimer = setInterval(pollClawbotQR, 2000);
      pollClawbotQR();
    } else if (d.status === "session_expired") {
      stopClawbotPoll();
      setClawbotStatus("会话已过期，请重新扫码", false);
    } else if (d.status === "idle") {
      setClawbotStatus("未连接", false);
    }
  });

})();

// 鈹€鈹€ Voice panel 鈹€鈹€
initVoicePanel({
  btnId:      "voice-btn",
  panelId:    "voice-panel",
  canvasId:   "voice-canvas",
  statusId:   "voice-status",
  transcriptId: "voice-transcript",
  getChatInput:  () => document.getElementById("msg-input"),
  getSendBtn:    () => document.getElementById("send-btn"),
  getSendMessage: (options) => chat?.send?.(options),
  getLang:       () => localStorage.getItem("xiaodun-voice-lang") || "zh-CN",
  getAutoSend:   () => localStorage.getItem("xiaodun-voice-auto-send") !== "false",
  getAutoMic:    () => localStorage.getItem("xiaodun-voice-auto-mic") === "true",
});


// 鈹€鈹€ Hotspot mode 鈹€鈹€
initHotspot().catch((err) => console.warn('[Hotspot] init failed:', err));


// 鈹€鈹€ Media modes (video / image) 鈹€鈹€
(function initMediaModes() {
  const videoBtn = document.getElementById("video-btn");
  const videoExitBtn = document.getElementById("video-exit-btn");
  const videoFeed = document.getElementById("video-feed");
  const videoFrame = document.getElementById("video-frame");
  const videoSurface = document.getElementById("video-surface");
  const videoBackdrop = document.getElementById("video-backdrop");
  const videoTitle = document.getElementById("video-title");
  const videoEmpty = document.getElementById("video-empty");
  const imageExitBtn = document.getElementById("image-exit-btn");
  const imageDisplay = document.getElementById("image-display");
  const imageSurface = document.getElementById("image-surface");
  const imageTitle = document.getElementById("image-title");

  let videoActive = false;
  let imageActive = false;
  let videoKind = "empty";
  let currentVideoSource = "";

  const normalizeUrl = (url = "") => String(url || "").trim();
  const youtubeId = (url) => normalizeUrl(url).match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([A-Za-z0-9_-]{6,})/)?.[1] || null;
  const bilibiliId = (url) => normalizeUrl(url).match(/\/video\/(BV[A-Za-z0-9]+)/i)?.[1] || normalizeUrl(url).match(/\b(BV[A-Za-z0-9]+)\b/i)?.[1] || null;
  const frameUrl = (url, autoplay = false) => {
    const yt = youtubeId(url);
    if (yt) return `https://www.youtube.com/embed/${yt}?enablejsapi=1&playsinline=1&rel=0&autoplay=${autoplay ? 1 : 0}`;
    const bv = bilibiliId(url);
    if (bv) return `https://player.bilibili.com/player.html?bvid=${bv}&autoplay=${autoplay ? 1 : 0}&high_quality=1`;
    return null;
  };

  function setVideoVisible(visible) {
    videoActive = Boolean(visible);
    document.body.classList.toggle("video-mode", videoActive);
    videoBtn?.classList.toggle("active", videoActive);
    if (videoActive) moveVoicePanelToBody();
    else restoreVoicePanel();
    window.dispatchEvent(new CustomEvent("xiaodun:video-mode", { detail: { active: videoActive, kind: videoKind } }));
  }

  function closeVideo() {
    try { videoFeed?.pause(); } catch {}
    if (videoFeed) {
      videoFeed.removeAttribute("src");
      videoFeed.hidden = true;
      videoFeed.load?.();
    }
    if (videoFrame) {
      videoFrame.removeAttribute("src");
      videoFrame.hidden = true;
    }
    videoSurface?.classList.remove("has-media");
    if (videoEmpty) videoEmpty.hidden = false;
    videoKind = "empty";
    currentVideoSource = "";
    setVideoVisible(false);
  }

  function showVideo({ url = "", title = "??", autoplay = true, muted = false, currentTime = 0 } = {}) {
    const source = normalizeUrl(url);
    if (!source) return;
    if (imageActive) setImageVisible(false);
    currentVideoSource = source;
    if (videoTitle) videoTitle.textContent = title || "??";
    if (videoBackdrop) videoBackdrop.style.backgroundImage = "";
    const embedded = frameUrl(source, autoplay);
    if (embedded && videoFrame) {
      videoKind = youtubeId(source) ? "youtube" : "bilibili";
      videoFrame.src = embedded;
      videoFrame.hidden = false;
      if (videoFeed) {
        videoFeed.hidden = true;
        videoFeed.removeAttribute("src");
      }
    } else if (videoFeed) {
      videoKind = "file";
      videoFeed.src = source;
      videoFeed.hidden = false;
      videoFeed.muted = Boolean(muted);
      if (Number.isFinite(Number(currentTime))) videoFeed.currentTime = Math.max(0, Number(currentTime));
      if (autoplay) videoFeed.play?.().catch(() => {});
      if (videoFrame) {
        videoFrame.hidden = true;
        videoFrame.removeAttribute("src");
      }
    }
    videoSurface?.classList.add("has-media");
    if (videoEmpty) videoEmpty.hidden = true;
    setVideoVisible(true);
  }

  function controlVideo({ action, volume, currentTime, autoplay } = {}) {
    if (action === "close" || action === "hide") {
      closeVideo();
      return;
    }
    if (!videoFeed) return;
    if (action === "play" || autoplay) videoFeed.play?.().catch(() => {});
    if (action === "pause") videoFeed.pause?.();
    if (Number.isFinite(Number(volume))) videoFeed.volume = Math.max(0, Math.min(1, Number(volume)));
    if (Number.isFinite(Number(currentTime))) videoFeed.currentTime = Math.max(0, Number(currentTime));
  }

  function setImageVisible(visible) {
    imageActive = Boolean(visible);
    document.body.classList.toggle("image-mode", imageActive);
    if (!imageActive && imageDisplay) {
      imageDisplay.removeAttribute("src");
      imageDisplay.alt = "";
      imageSurface?.classList.remove("has-media");
    }
  }

  function showImage({ url = "", image_url: imageUrl = "", title = "??", alt = "" } = {}) {
    const source = normalizeUrl(url || imageUrl);
    if (!source || !imageDisplay) return;
    if (videoActive) closeVideo();
    if (imageTitle) imageTitle.textContent = title || "??";
    imageDisplay.src = source;
    imageDisplay.alt = alt || title || "";
    imageSurface?.classList.add("has-media");
    setImageVisible(true);
  }

  function handleMediaCommand(payload = {}) {
    const mode = payload.mode || payload.kind;
    const action = payload.action || "show";
    if (mode === "image") {
      if (action === "close" || action === "hide") setImageVisible(false);
      else showImage(payload);
      return { ok: true, mode, action };
    }
    if (mode === "video") {
      if (action === "show" || payload.url) showVideo(payload);
      else controlVideo(payload);
      return { ok: true, mode, action };
    }
    return { ok: false, error: "unsupported_media_mode" };
  }

  videoExitBtn?.addEventListener("click", closeVideo);
  imageExitBtn?.addEventListener("click", () => setImageVisible(false));
  videoBtn?.addEventListener("click", () => (videoActive ? closeVideo() : showVideo({ url: currentVideoSource })));
  window.addEventListener("xiaodun:media", (event) => handleMediaCommand(event.detail || {}));
  window.xiaodunMedia = { handle: handleMediaCommand, showVideo, controlVideo, showImage, closeVideo };
})();
