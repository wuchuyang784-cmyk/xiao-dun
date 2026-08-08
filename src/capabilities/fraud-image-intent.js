const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/i
const MEDIA_CHAT_RE = /\/media\/chat\/[A-Za-z0-9._%+-]+\.(?:png|jpe?g|webp|gif|bmp)/i
const DATA_IMAGE_RE = /data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i
const IMAGE_FILE_RE = /(?:^|[\s"'(])(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\.{0,2}[\\/]|\/|[^\s"'()]+[\\/])?[^\s"'()]+\.(?:png|jpe?g|webp|gif|bmp)(?=$|[\s"'?)])/i

const ORDINARY_IMAGE_REQUEST_RE = /这是什么|描述一下|识别一下|翻译|按钮|界面|UI|设计|风景|宠物|猫|狗|照片好看|图片内容|看图说话/i
const STRONG_FRAUD_INTENT_RE = /诈骗|骗局|被骗|骗子|反诈|涉诈|欺诈|骗钱|骗取|钓鱼|冒充|公检法|刷单|返利|投资诈骗|贷款诈骗|图片反诈|check[_\s-]?image|fraud|scam|phishing/i
const RISK_ANALYSIS_INTENT_RE = /风险(?:分析|判断|研判|识别|检查|吗|么|不)|可疑|是否安全|安全吗|安全不安全|安全性|风险等级|风险评估|风险研判|诈骗风险|fraud risk|scam risk|phishing risk/i

export function hasImageReference(text = '') {
  const value = String(text || '')
  return MARKDOWN_IMAGE_RE.test(value)
    || MEDIA_CHAT_RE.test(value)
    || DATA_IMAGE_RE.test(value)
    || IMAGE_FILE_RE.test(value)
}

export function hasFraudImageIntent(text = '') {
  const value = String(text || '')
  if (STRONG_FRAUD_INTENT_RE.test(value)) return true
  if (ORDINARY_IMAGE_REQUEST_RE.test(value)) return false
  return RISK_ANALYSIS_INTENT_RE.test(value)
}

export function shouldAnalyzeFraudImage(text = '') {
  return hasImageReference(text) && hasFraudImageIntent(text)
}
