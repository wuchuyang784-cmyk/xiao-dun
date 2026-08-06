// @ts-check
// ─────────────────────────────────────────────────────────────
// PgFraudCaseStore — PostgreSQL 17 + pgvector 实现框架
//
// 当前为占位；所有方法返回空值以确保程序不会因引用了此文件而崩溃。
// 后续接入时只需：
//   1) 确保 PostgreSQL 已安装 pgvector 扩展
//   2) 配置环境变量 FRAUD_PG_CONNECTION_STRING
//   3) 取消下方 createConnection / sql 模板的注释并填入真实逻辑
//   4) 在 store-factory.js 中将 FRAUD_STORE=pgvector 路由到此
//
// DDL 模板（在目标 PostgreSQL 中执行一次）：
// ============================================================
// CREATE EXTENSION IF NOT EXISTS vector;
//
// CREATE TABLE IF NOT EXISTS fraud_cases (
//   id              SERIAL PRIMARY KEY,
//   case_id         TEXT UNIQUE NOT NULL,
//   province_code   VARCHAR(6) NOT NULL,
//   province_name   TEXT NOT NULL,
//   longitude       DOUBLE PRECISION NOT NULL,
//   latitude        DOUBLE PRECISION NOT NULL,
//   fraud_type      TEXT NOT NULL,
//   risk_level      TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),
//   loss_amount     DOUBLE PRECISION NOT NULL DEFAULT 0,
//   status          TEXT NOT NULL DEFAULT 'active',
//   occurred_at     TIMESTAMPTZ NOT NULL,
//   summary         TEXT NOT NULL DEFAULT '',
//   content         TEXT NOT NULL DEFAULT '',
//   review_status   TEXT NOT NULL DEFAULT 'approved',
//   version         INTEGER NOT NULL DEFAULT 1,
//   source          TEXT NOT NULL DEFAULT '',
//   embedding       vector(1024),        -- BGE-large-zh-v1.5: 1024 维
//   created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
//   updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
// );
//
// -- 向量索引（IVFFlat，适合 1w~100w 级数据）
// CREATE INDEX IF NOT EXISTS idx_fraud_cases_embedding
//   ON fraud_cases USING ivfflat (embedding vector_cosine_ops)
//   WITH (lists = 100);
//
// 相似搜索 SQL 模板（在 service 层调用）：
// ============================================================
// SELECT
//   case_id,
//   1 - (embedding <=> $1::vector) AS score,
//   province_code, province_name, longitude, latitude,
//   fraud_type, risk_level, loss_amount, status, occurred_at,
//   summary, content, review_status, version, source,
//   created_at, updated_at
// FROM fraud_cases
// WHERE embedding IS NOT NULL
// ORDER BY embedding <=> $1::vector
// LIMIT $2
// ============================================================
// ─────────────────────────────────────────────────────────────

/** @implements {ReturnType<typeof import('./fraud-case-store.js').FraudCaseStoreContract>} */
export const pgFraudCaseStore = {
  // ─── 核心 CRUD（待实现） ───

  /** @param {import('./fraud-case-store.js').FraudCaseDTO} _item */
  insert(_item) {
    throw new Error('PgFraudCaseStore not implemented yet. Set FRAUD_STORE=sqlite or implement PostgreSQL connection.')
  },

  /** @param {import('./fraud-case-store.js').FraudCaseDTO} _item */
  upsert(_item) {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },

  /** @param {string} _caseId */
  getById(_caseId) {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },

  /** @param {import('./fraud-case-store.js').CaseListOptions} [_opts] */
  list(_opts) {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },

  /** @returns {Map<string, import('./fraud-case-store.js').ProvinceStat>} */
  getProvinceStatistics() {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },

  /** @returns {number} */
  count() {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },

  // ─── RAG 向量检索（待实现） ───

  /**
   * 使用 pgvector 余弦相似度检索 top-K 相似案例
   * @param {Float32Array|number[]} _embedding  — BGE-large-zh 1024 维向量
   * @param {number} [_topK]
   * @returns {Promise<import('./fraud-case-store.js').SimilarCaseResult[]>}
   */
  async searchSimilar(_embedding, _topK = 5) {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },

  /**
   * 批量生成 embedding 并写入向量列
   * @param {import('./fraud-case-store.js').FraudCaseDTO[]} _cases
   * @returns {Promise<{ indexed: number, failed: number }>}
   */
  async bulkIndex(_cases) {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },

  /** @param {string} _caseId */
  async removeIndex(_caseId) {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },

  /** @returns {number} */
  pendingIndexCount() {
    throw new Error('PgFraudCaseStore not implemented yet.')
  },
}
