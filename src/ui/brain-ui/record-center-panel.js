export function createRecordCenterPanel() {
  return `
  <section class="record-center-panel" id="record-center-panel" aria-label="\u8bc8\u9a97\u5206\u6790\u5907\u6848\u4e2d\u5fc3">
    <div class="record-center-grid" aria-hidden="true"></div>
    <header class="record-center-header">
      <div>
        <div class="record-center-kicker">XIAODUN / ANALYSIS ARCHIVE</div>
        <h1>\u5907\u6848\u4e2d\u5fc3</h1>
        <p>\u6bcf\u6b21\u56fe\u7247\u3001\u77ed\u4fe1\u3001\u94fe\u63a5\u8bc8\u9a97\u5206\u6790\u90fd\u4f1a\u5199\u5165\u672c\u5730 SQLite\uff0c\u53ef\u968f\u65f6\u68c0\u7d22\u4e0e\u56de\u770b\u3002</p>
      </div>
      <div class="record-center-head-actions">
        <span class="record-center-live" id="record-center-live"><i></i>READY</span>
        <button class="record-center-close" id="record-center-close" type="button" aria-label="\u5173\u95ed\u5907\u6848\u4e2d\u5fc3">?</button>
      </div>
    </header>

    <div class="record-center-metrics">
      <div><small>TOTAL RECORDS</small><strong id="record-center-total-count">--</strong></div>
      <div><small>TODAY</small><strong id="record-center-today-count">--</strong></div>
      <div><small>HIGH RISK</small><strong id="record-center-high-count">--</strong></div>
      <div><small>TYPES</small><strong id="record-center-kind-count">--</strong></div>
    </div>

    <div class="record-center-workspace">
      <form class="record-center-form" id="record-center-form">
        <div class="record-center-section-title"><span>01</span> FILTER RECORDS</div>
        <div class="record-form-row record-form-row-two">
          <label>\u5206\u6790\u7c7b\u578b / KIND
            <select id="record-filter-kind" name="analysisKind">
              <option value="">\u5168\u90e8</option>
              <option value="image">\u56fe\u7247\u5206\u6790</option>
              <option value="sms">\u77ed\u4fe1/\u804a\u5929\u6587\u672c</option>
              <option value="link">\u94fe\u63a5\u68c0\u6d4b</option>
            </select>
          </label>
          <label>\u98ce\u9669\u7b49\u7ea7 / RISK
            <select id="record-filter-risk" name="riskLevel">
              <option value="">\u5168\u90e8</option>
              <option value="low">\u4f4e\u98ce\u9669</option>
              <option value="medium">\u4e2d\u98ce\u9669</option>
              <option value="high">\u9ad8\u98ce\u9669</option>
              <option value="critical">\u4e25\u91cd</option>
            </select>
          </label>
        </div>
        <div class="record-form-row record-form-row-two">
          <label>\u5de5\u5177 / TOOL
            <select id="record-filter-tool" name="toolName">
              <option value="">\u5168\u90e8</option>
              <option value="analyze_fraud_image">\u56fe\u7247\u5206\u6790</option>
              <option value="check_sms">\u77ed\u4fe1/\u804a\u5929\u68c0\u6d4b</option>
              <option value="check_link">\u94fe\u63a5\u68c0\u6d4b</option>
            </select>
          </label>
          <label>\u72b6\u6001 / STATUS
            <select id="record-filter-status" name="analysisStatus">
              <option value="">\u5168\u90e8</option>
              <option value="done">\u5df2\u5b8c\u6210</option>
              <option value="partial">\u90e8\u5206\u5b8c\u6210</option>
              <option value="failed">\u5931\u8d25</option>
            </select>
          </label>
        </div>
        <div class="record-form-row record-form-row-two">
          <label>\u5f00\u59cb\u65e5\u671f / FROM
            <input id="record-filter-from" name="dateFrom" type="date">
          </label>
          <label>\u7ed3\u675f\u65e5\u671f / TO
            <input id="record-filter-to" name="dateTo" type="date">
          </label>
        </div>
        <label>\u5173\u952e\u5b57 / KEYWORD
          <input id="record-filter-keyword" name="keyword" type="text" maxlength="120" placeholder="\u8f93\u5165\u98ce\u9669\u8bcd\u3001\u94fe\u63a5\u3001\u6458\u8981\u5173\u952e\u8bcd">
          <small>\u5339\u914d\u6458\u8981\u548c\u8bc8\u9a97\u7c7b\u578b\uff1b\u4e0d\u4f1a\u66b4\u9732\u539f\u59cb\u654f\u611f\u5185\u5bb9\u3002</small>
        </label>
        <div class="record-center-actions">
          <button class="record-center-button" id="record-center-search" type="submit"><span>SEARCH RECORDS</span><i></i></button>
          <button class="record-center-button secondary" id="record-center-reset" type="button">RESET</button>
        </div>
      </form>

      <aside class="record-center-activity">
        <div class="record-center-section-title"><span>02</span> RECORD LIST</div>
        <div class="record-center-status" id="record-center-status">
          <b>\u7b49\u5f85\u67e5\u8be2</b>
          <span>\u6253\u5f00\u9762\u677f\u540e\u81ea\u52a8\u52a0\u8f7d\u6700\u8fd1 20 \u6761\u5907\u6848\u8bb0\u5f55</span>
        </div>
        <div class="record-recent-title"><span>RECENT RECORDS</span><em id="record-center-subtitle">--</em></div>
        <div class="record-recent-list" id="record-center-list">
          <div class="record-recent-empty">\u6682\u65e0\u5907\u6848\u8bb0\u5f55</div>
        </div>
        <div class="record-detail-title">DETAIL</div>
        <pre class="record-detail" id="record-center-detail">\u5c1a\u672a\u9009\u62e9\u8bb0\u5f55\u3002</pre>
      </aside>
    </div>
  </section>`
}
