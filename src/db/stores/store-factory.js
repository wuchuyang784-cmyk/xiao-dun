// @ts-check
// FraudCaseStore factory.
//
// Selects the storage adapter via FRAUD_STORE.

let storeInstance = null

/** @returns {Promise<any>} */
export async function getFraudCaseStore() {
  if (storeInstance) return storeInstance

  const provider = (process.env.FRAUD_STORE || 'sqlite').trim().toLowerCase()

  if (provider === 'pgvector' || provider === 'pg') {
    const { pgFraudCaseStore } = await import('./pg-fraud-case-store.js')
    storeInstance = pgFraudCaseStore
    console.log('[fraud-case-store] using PostgreSQL store (FRAUD_STORE=pgvector)')
  } else {
    const { sqliteFraudCaseStore } = await import('./sqlite-fraud-case-store.js')
    storeInstance = sqliteFraudCaseStore
    if (provider !== 'sqlite') {
      console.warn(`[fraud-case-store] unknown FRAUD_STORE="${provider}", falling back to sqlite`)
    }
  }

  return storeInstance
}

/**
 * Force-set the store for tests.
 * @param {ReturnType<typeof import('./fraud-case-store.js').FraudCaseStoreContract>} store
 */
export function _setFraudCaseStoreForTest(store) {
  storeInstance = store
}

/** Reset the cached store instance for tests. */
export function _resetFraudCaseStoreForTest() {
  storeInstance = null
}
