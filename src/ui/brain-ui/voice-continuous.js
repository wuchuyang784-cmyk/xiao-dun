// voice-continuous.js ?? ????????
//
// ???????? ASR ???????????????
// ???????? ASR ??? voice-core.js ???

export function createContinuousPolicy(core, { getAutoSend }) {
  const SILENCE_SEND_MS = (() => {
    const value = Number.parseInt(localStorage.getItem('xiaodun-voice-silence-ms') || '', 10);
    return Number.isFinite(value) && value >= 800 ? value : 2000;
  })();

  let autoSendTimer = null;
  let lastTranscriptActivityTs = 0;
  let lastObservedTranscriptText = '';

  function noteTranscriptActivity() {
    lastTranscriptActivityTs = Date.now();
  }

  function scheduleAutoSend() {
    if (core.pttHolding || getAutoSend?.() === false) return;
    noteTranscriptActivity();
    if (autoSendTimer) return;

    const tick = () => {
      const idle = Date.now() - lastTranscriptActivityTs;
      if (idle >= SILENCE_SEND_MS) {
        autoSendTimer = null;
        lastObservedTranscriptText = '';
        core.setStatus('processing');
        core.sendRecognizedVoiceText();
      } else {
        autoSendTimer = setTimeout(tick, SILENCE_SEND_MS - idle);
      }
    };

    autoSendTimer = setTimeout(tick, SILENCE_SEND_MS);
  }

  function cancelAutoSend() {
    if (autoSendTimer) {
      clearTimeout(autoSendTimer);
      autoSendTimer = null;
    }
  }

  function onFrame() {
    // ?????????????????ASR-only ???????????
  }

  function onTranscript() {
    const currentText = (core.getText?.() || '').trim();
    if (!currentText || currentText === lastObservedTranscriptText) return;
    lastObservedTranscriptText = currentText;
    scheduleAutoSend();
  }

  function onSessionStop() {
    cancelAutoSend();
    lastTranscriptActivityTs = 0;
    lastObservedTranscriptText = '';
  }

  return {
    onFrame,
    onTranscript,
    onSessionStop,
    cancelAutoSend,
  };
}
