// @ts-check
// ─────────────────────────────────────────────────────────────
// FraudCaseStore — 诈骗案例数据存储抽象接口
//
// 设计意图：
//   当前有 SqliteFraudCaseStore（生产），后续接入 PgFraudCaseStore
//   （PostgreSQL 17 + pgvector）。Service 层只依赖此接口，切换 store
//   只需改一行工厂代码。
//
// 所有实现必须满足本契约；新增方法先在接口里声明再在适配器中实现。
// ─────────────────────────────────────────────────────────────

/**
 * 诈骗案例 DTO（Data Transfer Object，接口间传输的标准形状）
 * @typedef {Object} FraudCaseDTO
 * @property {string} caseId          — 唯一 ID
 * @property {string} provinceCode    — 省代码 110000~820000
 * @property {string} provinceName    — 省名称
 * @property {number} longitude
 * @property {number} latitude
 * @property {string} fraudType       — 诈骗类型
 * @property {'low'|'medium'|'high'|'critical'} riskLevel
 * @property {number} lossAmount      — 损失金额（非负）
 * @property {string} status          — active / processing / closed
 * @property {string} occurredAt      — ISO 8601 发生时间
 * @property {string} summary         — 简要描述
 * @property {string} content         — 全文（用于生成向量；至少 ≥ summary）
 * @property {string} reviewStatus    — pending_review / approved
 * @property {number} version
 * @property {string} source
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * 省份统计项
 * @typedef {Object} ProvinceStat
 * @property {string} provinceCode
 * @property {string} provinceName
 * @property {number} caseCount
 * @property {number} highRiskCount
 * @property {number} pendingCount
 * @property {number} totalLossAmount
 */

/**
 * 案例列表查询参数
 * @typedef {Object} CaseListOptions
 * @property {string} [provinceCode]  — 按省筛选
 * @property {number} [limit]         — 返回条数，默认 30，最大 100000
 * @property {number} [offset]        — 分页偏移
 */

/**
 * 相似案例搜索结果
 * @typedef {Object} SimilarCaseResult
 * @property {string} caseId
 * @property {number} score           — 相似度（1=最相似）
 * @property {FraudCaseDTO} _case     — 完整 DTO
 */

/**
 * FraudCaseStore 接口
 *
 * 所有方法: 同步（SQLite）实现，异步（pgvector）实现包装 sync。
 * Service 层统一 await 调用，不关心底层是 sync 还是 async。
 */
export const FraudCaseStoreContract = {
  /** @type {(item: Omit<FraudCaseDTO, 'createdAt'|'updatedAt'>) => boolean} */
  insert(item) { throw new Error('not implemented') },

  /** @type {(item: Omit<FraudCaseDTO, 'createdAt'|'updatedAt'>) => { created: boolean, updated: boolean }} */
  upsert(item) { throw new Error('not implemented') },

  /** @type {(caseId: string) => FraudCaseDTO|null} */
  getById(caseId) { throw new Error('not implemented') },

  /** @type {(opts?: CaseListOptions) => FraudCaseDTO[]} */
  list(opts) { throw new Error('not implemented') },

  /** @type {() => Map<string, ProvinceStat>} */
  getProvinceStatistics() { throw new Error('not implemented') },

  /** @type {() => number} */
  count() { throw new Error('not implemented') },

  /**
   * 语义相似案例检索
   * SQLite 实现返回空数组（不支持，由 service 层降级为 FTS5 / 关键词匹配）
   * pgvector 实现返回真正的向量相似度排序结果
   * @type {(embedding: Float32Array|number[], topK?: number) => Promise<SimilarCaseResult[]>}
   */
  async searchSimilar(embedding, topK = 5) { throw new Error('not implemented') },

  /**
   * 批量回填向量索引（全量或增量）
   * SQLite: no-op
   * pgvector: 对未索引案例生成 embedding 并写入向量列
   * @type {(cases: FraudCaseDTO[]) => Promise<{ indexed: number, failed: number }>}
   */
  async bulkIndex(cases) { throw new Error('not implemented') },

  /**
   * 删除单条案例的向量（从索引中移除）
   * @type {(caseId: string) => Promise<void>}
   */
  async removeIndex(caseId) { throw new Error('not implemented') },

  /**
   * 统计待索引数量
   * SQLite: 返回 0（无此概念）
   * pgvector: 查询 embedding IS NULL 的行数
   * @type {() => number}
   */
  pendingIndexCount() { throw new Error('not implemented') },
}
