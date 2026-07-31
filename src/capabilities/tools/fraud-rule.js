// 反诈规则引擎工具：fraud_rule_screen
//
// 供 LLM 在「风险研判」链中主动调用，对用户提交的对话 / 聊天记录 / 转账邀请 / 链接文案
// 做诈骗话术专用规则匹配，输出命中类型、风险分、话术证据、套路拆解与处置建议。
//
// 与 context/rule-engine.js（运行时上下文注入）无关；这里是真正的反诈核心工具。

import { runFraudRuleEngine, FRAUD_RULE_ENGINE_VERSION } from '../../context/fraud-rule-engine.js'

function toolJson(obj, ok = true) {
  return JSON.stringify({ ok, ...obj }, null, 2)
}

/**
 * 执行反诈规则筛查。
 * @param {string|{text?:string,content?:string,message?:string}} args
 * @returns {string} JSON 字符串
 */
export function execFraudRuleScreen(args = {}) {
  const raw = typeof args === 'string' ? args : (args?.text || args?.content || args?.message || '')
  const text = String(raw || '').trim()

  if (!text) {
    return toolJson({ error: '请提供待研判文本（参数 text）' }, false)
  }

  const result = runFraudRuleEngine(text)
  return toolJson({
    version: FRAUD_RULE_ENGINE_VERSION,
    ...result,
  })
}
