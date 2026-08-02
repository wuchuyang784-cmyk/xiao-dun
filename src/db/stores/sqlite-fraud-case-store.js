// @ts-check
// SQLite implementation of FraudCaseStore.
//
// This adapter directly delegates to the repository helpers backed by the
// local SQLite database.

import {
  insertFraudCase,
  upsertFraudCase,
  getFraudCaseById,
  listFraudCases,
  getFraudProvinceStatistics,
  countFraudCases,
} from '../repositories/fraud-cases.js'

/** @implements {ReturnType<typeof import('./fraud-case-store.js').FraudCaseStoreContract>} */
export const sqliteFraudCaseStore = {
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
}
