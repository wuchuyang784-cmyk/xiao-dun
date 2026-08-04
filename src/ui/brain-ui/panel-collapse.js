const STORAGE_L1 = "xiaodun-panel-l1-collapsed";
const STORAGE_L2 = "xiaodun-panel-l2-collapsed";

function storageKeyForSide(side) {
  return side === "l1" ? STORAGE_L1 : STORAGE_L2;
}

function classForSide(side) {
  return side === "l1" ? "l1-collapsed" : "l2-collapsed";
}

function tabIdForSide(side) {
  return side === "l1" ? "panel-l1-tab" : "panel-l2-tab";
}

export function initPanelCollapse() {
  /**
   * 同步按钮的 aria-expanded。按钮是纯图标（无文字），折叠状态在视觉上靠
   * 「按钮迁移到视口角 + 图标侧栏条收成细线」表达，读屏用户则依赖这个属性。
   */
  function syncTabState(side) {
    const collapsed = document.body.classList.contains(classForSide(side));
    document.getElementById(tabIdForSide(side))?.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }

  function setPanel(side, collapsed) {
    document.body.classList.toggle(classForSide(side), collapsed);
    syncTabState(side);
    try { localStorage.setItem(storageKeyForSide(side), collapsed ? "1" : "0"); } catch {}
  }

  function togglePanel(side) {
    const cls = classForSide(side);
    setPanel(side, !document.body.classList.contains(cls));
  }

  try {
    if (localStorage.getItem(STORAGE_L1) === "1") document.body.classList.add("l1-collapsed");
    if (localStorage.getItem(STORAGE_L2) === "1") document.body.classList.add("l2-collapsed");
  } catch {}

  syncTabState("l1");
  syncTabState("l2");

  document.getElementById("panel-l1-tab")?.addEventListener("click", () => togglePanel("l1"));
  document.getElementById("panel-l2-tab")?.addEventListener("click", () => togglePanel("l2"));

  window.addEventListener("keydown", (event) => {
    if (event.target && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA" || event.target.isContentEditable)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "[") { event.preventDefault(); togglePanel("l1"); }
    if (event.key === "]") { event.preventDefault(); togglePanel("l2"); }
  });
}

