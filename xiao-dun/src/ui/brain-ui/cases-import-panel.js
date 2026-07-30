// 案例导入 / 知识库 面板：iframe 壳，内容在独立的 cases-import.html
// （由 /src/ui/brain-ui/ 静态路由提供，页面自带上传、预览、进度与回填逻辑；
//   面板只负责开关、与其他全屏模式互斥、状态上报，见 cases-import.js）
export const createCasesImportPanel = () => `
<div class="cases-import-panel" id="cases-import-panel">
  <iframe id="cases-import-frame" class="cases-import-frame" title="案例导入 / 知识库"></iframe>
  <button class="ci-exit-btn" id="ci-exit-btn" type="button" title="关闭案例导入">×</button>
</div>
`
