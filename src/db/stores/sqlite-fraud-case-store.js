// @ts-check
// ─────────────────────────────────────────────────────────────
// SqliteFraudCaseStore — SQLite 实现 FraudCaseStore 接口
//
// 包装现有的 src/db/repositories/fraud-cases.js 仓库函数，
// 补齐接口定义的 searchSimilar / bulkIndex / removeIndex / pendingIndexCount。
// SQLite 不支持向量检索，这些方法为安全空实现。
//
// 后续迁移到 PostgreSQL + pgvector 时，只需将此文件替换为
// PgFraudCaseStore（或通过工厂切换），上层不改一行代码。
// ─────────────────────────────────────────────────────────────

import {
  insertFraudCase,
  upsertFraudCase,
  getFraudCaseById,
  listFraudCases,
  getFraudProvinceStatistics,
  countFraudCases,
  countPendingIndex,
} from '../repositories/fraud-cases.js'

/** @implements {ReturnType<typeof import('./fraud-case-store.js').FraudCaseStoreContract>} */
export const sqliteFraudCaseStore = {
  // ─── 核心 CRUD（直接委托现有仓库） ───

  /** @param {import('./fraud-case-store.js').FraudCaseDTO} item @param {Object} [opts] */
  insert(item, opts) {
    return insertFraudCase(item, opts)
  },

  /** @param {import('./fraud-case-store.js').FraudCaseDTO} item */
  upsert(item) {
    return upsertFraudCase(item)
  },

  /** @param {string} caseId */
  getById(caseId) {
    return getFraudCaseById(caseId)
  },

  /** @param {import('./fraud-case-store.js').CaseListOptions} [opts] */
  list(opts = {}) {
    return listFraudCases({
      provinceCode: opts.provinceCode || '',
      limit: Math.min(100000, Math.max(1, Number(opts.limit) || 30)),
    })
  },

  /** @returns {Map<string, import('./fraud-case-store.js').ProvinceStat>} */
  getProvinceStatistics() {
    return getFraudProvinceStatistics()
  },

  /** @returns {number} */
  count() {
    return countFraudCases()
  },

  // ─── RAG 向量检索（SQLite 不含向量能力，全部安全降级） ───

  /**
   * SQLite 不持向量，返回空数组。
   * service 层检测到空结果后应降级为 FTS5 全文 / 关键词匹配。
   * @param {Float32Array|number[]} _embedding
   * @param {number} [_topK]
   * @returns {Promise<import('./fraud-case-store.js').SimilarCaseResult[]>}
   */
  async searchSimilar(_embedding, _topK = 5) {
    return []
  },

  /**
   * SQLite 无向量列，批量索引为空操作。
   * 后续 pgvector 实现会在此生成 embedding 并写入向量列。
   * @param {import('./fraud-case-store.js').FraudCaseDTO[]} _cases
   * @returns {Promise<{ indexed: number, failed: number }>}
   */
  async bulkIndex(_cases) {
    return { indexed: 0, failed: 0 }
  },

  /**
   * SQLite: no-op
   * @param {string} _caseId
   */
  async removeIndex(_caseId) {
    // no-op
  },

  /**
   * 返回 vector_indexed=0 的案例数（存量旧字段，后续 pgvector 迁移后移除）
   * @returns {number}
   */
  pendingIndexCount() {
    return countPendingIndex()
  },
}
