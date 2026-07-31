// @ts-check
// ─────────────────────────────────────────────────────────────
// store-factory.js — FraudCaseStore 工厂
//
// 通过环境变量 FRAUD_STORE 选择存储后端：
//   - 'sqlite'（默认）：使用现有 SQLite 数据库
//   - 'pgvector'：PostgreSQL 17 + pgvector（待接入）
//
// 用法：
//   import { getFraudCaseStore } from './store-factory.js'
//   const store = getFraudCaseStore()
//   await store.searchSimilar(embedding, 5)
// ─────────────────────────────────────────────────────────────

let storeInstance = null

/** @returns {Promise<any>} */
export async function getFraudCaseStore() {
  if (storeInstance) return storeInstance

  const provider = (process.env.FRAUD_STORE || 'sqlite').trim().toLowerCase()

  if (provider === 'pgvector' || provider === 'pg') {
    const { pgFraudCaseStore } = await import('./pg-fraud-case-store.js')
    storeInstance = pgFraudCaseStore
    console.log('[fraud-case-store] using PostgreSQL + pgvector (FRAUD_STORE=pgvector)')
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
 * 强制设置 store（测试用）
 * @param {ReturnType<typeof import('./fraud-case-store.js').FraudCaseStoreContract>} store
 */
export function _setFraudCaseStoreForTest(store) {
  storeInstance = store
}

/**
 * 重置 store 单例（测试后清理）
 */
export function _resetFraudCaseStoreForTest() {
  storeInstance = null
}
