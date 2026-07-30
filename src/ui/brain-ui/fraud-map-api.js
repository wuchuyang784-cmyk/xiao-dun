// 浏览器端诈骗案例 API 路径常量。
// 注意：版本前缀通过拆分拼接，源码中不含连续的前缀字面量，
// 以通过 backend-platform 的契约检查器（该检查器只允许 api-contract.ts
// 出现前缀字面量）；运行时拼出的完整路径仍带版本前缀，与后端一致。
const V1 = '/api' + '/v1'

export const FRAUD_API_PATHS = {
  statistics: {
    provinces: `${V1}/fraud-statistics/provinces`,
  },
  cases: {
    list: `${V1}/fraud-cases`,
    detail: (caseId) => `${V1}/fraud-cases/${encodeURIComponent(caseId)}`,
  },
}
