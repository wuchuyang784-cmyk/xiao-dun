// @ts-check
// PostgreSQL store placeholder.
//
// The adapter keeps the same FraudCaseStore contract as the SQLite
// implementation. It is intentionally not implemented yet.

/** @implements {ReturnType<typeof import('./fraud-case-store.js').FraudCaseStoreContract>} */
export const pgFraudCaseStore = {
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
}
