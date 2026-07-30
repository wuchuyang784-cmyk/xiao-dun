// 记录备案 面板：iframe 壳，内容在独立的 record.html
// （页面自带筛选、列表、详情抽屉；面板只负责开关、与其他全屏模式互斥、状态上报）
export const createRecordPanel = () => `
<div class="record-panel" id="record-panel">
  <iframe id="record-frame" class="record-frame" title="AI 分析备案"></iframe>
  <button class="rec-exit-btn" id="rec-exit-btn" type="button" title="关闭记录备案">×</button>
</div>
`
