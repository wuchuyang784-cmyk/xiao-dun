// voice-panel.js —— 语音面板编排层
//
// 组装共享会话引擎（voice-core）+ 两个模式策略（常开 voice-continuous / 按住空格 voice-ptt），
//
// 解耦结构：
//   voice-core.js       共享机制——点云渲染 + 麦克风采集 + ASR 传输/转录 + 会话生命周期
//   voice-continuous.js  常开策略——自动断句发送 + barge-in 打断检测（会话默认策略）
//   voice-ptt.js         PTT 策略——按住门控 + 松手立即发送（在常开策略之上叠加）
//
// 改一个模式的策略只动对应文件，底层机制集中在 core；两模式共用同一个 core 会话，
// 以保持「常开在跑时按空格 = 强制立即发一次」的叠加语义。

import { createVoiceCore } from './voice-core.js';
import { createContinuousPolicy } from './voice-continuous.js';
import { createPttController } from './voice-ptt.js';
import { createWakeFlow } from './voice-wake.js';

export function initVoicePanel({
  btnId, panelId, canvasId, statusId, transcriptId,
  getChatInput, getSendBtn, getSendMessage, getLang, getAutoSend, getAutoMic,
}) {
  const btn        = document.getElementById(btnId);
  const panel      = document.getElementById(panelId);
  const canvas     = document.getElementById(canvasId);
  const transcript = document.getElementById(transcriptId);

  if (!panel || !canvas) return;

  // ─── 组装 core + 两个模式策略 ───
  const core = createVoiceCore({ canvas, transcript, getChatInput, getSendMessage, getLang });
  const continuous = createContinuousPolicy(core, { getAutoSend });

  // 常开会话开关：点球/按钮触发，也被 PTT 在「mic 未开」时复用（保持叠加语义）
  async function toggleVoice() {
    if (!core.micActive) {
      // startSession 内部已处理失败回退 + 状态同步
      return Boolean(await core.startSession());
    }
    core.stopSession();
    return false;
  }

  const ptt = createPttController(core, {
    toggleVoice,
    cancelAutoSend: continuous.cancelAutoSend,
  });

  // 唤醒会话编排（命中「小盾」→ 悬浮球入场 → 10s 无话退场）。非 Electron 环境内部自动失能。
  const wake = createWakeFlow(core);

  // 安装模式策略钩子：continuous = 会话默认策略；PTT 通过 core.pttHolding 在其上叠加。
  // 每帧：先喂唤醒编排（把状态+真实音量+文字推给悬浮球窗），再走 continuous 打断检测。
  core.setOnFrame((vol, frame) => {
    wake.onFrame(vol, frame);
    continuous.onFrame(vol, frame);
  });
  // 转写到达：先喂唤醒编排（用于「10s 内是否识别到语音」判定），再走 continuous 自动发送策略。
  core.setOnTranscript((msg, isFinal) => {
    wake.onTranscript(msg, isFinal);
    continuous.onTranscript(msg, isFinal);
  });
  core.setOnSessionStop(continuous.onSessionStop);
  // 会话状态变化 → 同步按钮高亮（mic 开着或用户保留了开麦意图时高亮）
  core.setOnState(() => {
    btn?.classList.toggle('active', core.micActive || core.userWantedMic);
  });

  // ─── 承重墙：window.xiaodunVoice 接口契约（app.js 依赖，不可改形状） ───
  window.xiaodunVoice = {
    isActive: () => core.micActive,
    // 视频/音乐模式：完全停止 mic（不需要打断能力）
    suspendForMedia: () => core.suspendForMedia(),
    resumeAfterMedia: () => core.resumeSession(),
    stop: () => core.stopSession(),
    setPlaybackState: (active) => core.setPlaybackState(active),
    pttStart: ptt.pttStart,
    pttEnd: ptt.pttEnd,
  };

  window.addEventListener('xiaodun:video-mode', (event) => {
    if (event.detail?.active) {
      window.xiaodunVoice.suspendForMedia();
    } else {
      window.xiaodunVoice.resumeAfterMedia();
    }
  });


  // ─── 面板初始化 ───
  function openPanel() {
    panel.hidden = false;
    core.startRenderLoop();
  }

  btn?.addEventListener('click', toggleVoice);
  canvas.addEventListener('click', toggleVoice);

  core.setStatus('idle');
  openPanel();
  if (getAutoMic?.()) toggleVoice();
}
