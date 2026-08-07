const MARKDOWN_IMAGE_RE = /!\[[^\]]*]\(([^)]+)\)/i
const MEDIA_CHAT_RE = /\/media\/chat\/[A-Za-z0-9._%+-]+\.(?:png|jpe?g|webp|gif|bmp)/i
const DATA_IMAGE_RE = /data:image\/(?:png|jpe?g|webp|gif|bmp);base64,/i

const FRAUD_IMAGE_TERMS = [
  '\u8bc8\u9a97', '\u9a97\u5c40', '\u88ab\u9a97', '\u9a97\u5b50', '\u53cd\u8bc8', '\u98ce\u9669', '\u53ef\u7591',
  '\u804a\u5929\u8bb0\u5f55', '\u804a\u5929\u622a\u56fe', '\u622a\u56fe', '\u8f6c\u8d26', '\u6c47\u6b3e', '\u6536\u6b3e',
  '\u4e8c\u7ef4\u7801', '\u9a8c\u8bc1\u7801', '\u94f6\u884c\u5361', '\u5bf9\u516c\u8d26\u6237', '\u5ba2\u670d',
  '\u5192\u5145', '\u516c\u68c0\u6cd5', '\u5237\u5355', '\u8fd4\u5229', '\u6295\u8d44', '\u8d37\u6b3e',
  '\u9493\u9c7c', '\u94fe\u63a5', '\u7f51\u5740', '\u9a8c\u56fe\u7247', '\u56fe\u7247\u53cd\u8bc8',
]

const ORDINARY_IMAGE_TERMS = [
  '\u8fd9\u662f\u4ec0\u4e48', '\u63cf\u8ff0\u4e00\u4e0b', '\u8bc6\u522b\u4e00\u4e0b', '\u7ffb\u8bd1',
  '\u6309\u94ae', '\u754c\u9762', 'UI', '\u8bbe\u8ba1', '\u98ce\u666f', '\u5ba0\u7269', '\u732b', '\u72d7',
  '\u7167\u7247\u597d\u770b', '\u56fe\u7247\u5185\u5bb9', '\u770b\u56fe\u8bf4\u8bdd',
]

const STRONG_FRAUD_TERMS = [
  '\u8bc8\u9a97', '\u9a97\u5c40', '\u88ab\u9a97', '\u98ce\u9669', '\u53ef\u7591', '\u53cd\u8bc8', '\u9493\u9c7c', '\u9a97\u5b50',
]

function includesAny(value, terms) {
  const text = String(value || '').toLowerCase()
  return terms.some(term => text.includes(String(term).toLowerCase()))
}

export function hasImageReference(text = '') {
  const value = String(text || '')
  return MARKDOWN_IMAGE_RE.test(value) || MEDIA_CHAT_RE.test(value) || DATA_IMAGE_RE.test(value)
}

export function hasFraudImageIntent(text = '') {
  const value = String(text || '')
  const hasFraudTerm = includesAny(value, FRAUD_IMAGE_TERMS) || /check[_\s-]?image|fraud|scam|phishing/i.test(value)
  if (!hasFraudTerm) return false
  if (includesAny(value, ORDINARY_IMAGE_TERMS) && !includesAny(value, STRONG_FRAUD_TERMS) && !/fraud|scam|phishing/i.test(value)) return false
  return true
}

export function shouldAnalyzeFraudImage(text = '') {
  return hasImageReference(text) && hasFraudImageIntent(text)
}

export function shouldAnalyzeFraudImageWithRecent(text = '', recentImageText = '') {
  return shouldAnalyzeFraudImage(text) || (hasImageReference(recentImageText) && hasFraudImageIntent(text))
}
