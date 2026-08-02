// @ts-check
// FraudCaseStore - fraud case data storage contract
//
// The service layer only depends on this contract. SQLite is the current
// production implementation; PostgreSQL can be swapped in later by providing
// another adapter that matches the same methods.

/**
 * Fraud case DTO used across store adapters.
 * @typedef {Object} FraudCaseDTO
 * @property {string} caseId
 * @property {string} provinceCode
 * @property {string} provinceName
 * @property {number} longitude
 * @property {number} latitude
 * @property {string} fraudType
 * @property {'low'|'medium'|'high'|'critical'} riskLevel
 * @property {number} lossAmount
 * @property {string} status
 * @property {string} occurredAt
 * @property {string} summary
 * @property {string} content
 * @property {string} reviewStatus
 * @property {number} version
 * @property {string} source
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * Province statistics.
 * @typedef {Object} ProvinceStat
 * @property {string} provinceCode
 * @property {string} provinceName
 * @property {number} caseCount
 * @property {number} highRiskCount
 * @property {number} pendingCount
 * @property {number} totalLossAmount
 */

/**
 * Query options for fraud case list.
 * @typedef {Object} CaseListOptions
 * @property {string} [provinceCode]
 * @property {number} [limit]
 * @property {number} [offset]
 */

/**
 * FraudCaseStore contract.
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
}
