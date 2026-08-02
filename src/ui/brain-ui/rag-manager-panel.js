export function createRagManagerPanel() {
  return `
  <section class="rag-manager-panel" id="rag-manager-panel" aria-label="RAG knowledge base manager">
    <div class="rag-manager-grid" aria-hidden="true"></div>
    <header class="rag-manager-header">
      <div>
        <div class="rag-manager-kicker">XIAODUN / VECTOR OPERATIONS</div>
        <h1>RAG Manager</h1>
        <p>向反诈知识库添加文本，并立即生成可检索的 512 维向量</p>
      </div>
      <div class="rag-manager-head-actions">
        <span class="rag-manager-live" id="rag-manager-live"><i></i>CONNECTING</span>
        <button class="rag-manager-close" id="rag-manager-close" type="button" aria-label="关闭 RAG Manager">×</button>
      </div>
    </header>

    <div class="rag-manager-metrics">
      <div><small>KNOWLEDGE BASE</small><strong id="rag-manager-version">--</strong></div>
      <div><small>TEXT RECORDS</small><strong id="rag-manager-text-count">--</strong></div>
      <div><small>VECTOR INDEX</small><strong id="rag-manager-vector-count">--</strong></div>
      <div><small>DIMENSION</small><strong id="rag-manager-dimension">512</strong></div>
    </div>

    <div class="rag-manager-workspace">
      <form class="rag-manager-form" id="rag-manager-form">
        <div class="rag-manager-section-title"><span>01</span> NEW KNOWLEDGE ENTRY</div>
        <div class="rag-form-row rag-form-row-two">
          <label>标题 / TITLE
            <input id="rag-item-title" name="title" type="text" maxlength="200" placeholder="例如：冒充客服退款新话术" required>
          </label>
          <label>风险分类 / CATEGORY
            <select id="rag-item-category" name="categoryCode" required>
              <option value="new_risk_type">新型诈骗风险</option>
              <option value="fake_bank_card">虚假银行卡与账户交易</option>
              <option value="fake_certification">虚假认证</option>
              <option value="fake_credentials">虚假证件</option>
              <option value="fake_sim_card">虚假手机卡</option>
              <option value="gambling">赌博引流</option>
              <option value="prohibited_drugs">违禁药品</option>
              <option value="unauthorized_cashout">非法套现</option>
              <option value="underground_loan">地下贷款</option>
              <option value="whoring_prostitution">色情招嫖</option>
            </select>
          </label>
        </div>
        <label class="rag-form-textarea">危险文本 / RISK TEXT
          <textarea id="rag-item-text" name="text" minlength="10" maxlength="8000" rows="8" placeholder="粘贴需要加入知识库的诈骗话术、案例描述或风险文本……" required></textarea>
          <span id="rag-item-counter">0 / 8000</span>
        </label>
        <div class="rag-form-row rag-form-row-two">
          <label>风险信号 / SIGNALS
            <input id="rag-item-signals" name="riskSignals" type="text" placeholder="屏幕共享，安全账户，验证码">
            <small>使用中文逗号或英文逗号分隔</small>
          </label>
          <label>关键短语 / KEY PHRASES
            <input id="rag-item-phrases" name="keyPhrases" type="text" placeholder="退款理赔，账户验证">
            <small>用于语义检索结果解释</small>
          </label>
        </div>
        <label class="rag-pii-check">
          <input id="rag-item-pii" name="piiConfirmed" type="checkbox" required>
          <span>我已确认内容不含手机号、身份证、银行卡号等个人敏感信息</span>
        </label>
        <button class="rag-index-button" id="rag-index-button" type="submit">
          <span>GENERATE VECTOR + ADD TO RAG</span><i></i>
        </button>
      </form>

      <aside class="rag-manager-activity">
        <div class="rag-manager-section-title"><span>02</span> INDEX ACTIVITY</div>
        <div class="rag-index-visual" id="rag-index-visual" aria-hidden="true">
          <div class="rag-vector-cube"><i></i><i></i><i></i></div>
          <b>512D</b><small>NORMALIZED / COSINE</small>
        </div>
        <div class="rag-manager-status" id="rag-manager-status">
          <b>等待新增数据</b>
          <span>提交后将在本机生成向量并写入 pgvector</span>
        </div>
        <div class="rag-recent-title">RECENTLY ADDED</div>
        <div class="rag-recent-list" id="rag-recent-list">
          <div class="rag-recent-empty">本次会话尚未添加数据</div>
        </div>
      </aside>
    </div>
  </section>`
}
