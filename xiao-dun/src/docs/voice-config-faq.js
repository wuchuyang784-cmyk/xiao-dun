// 语音配置说明文档 & FAQ
// 结构：每个 topic 包含 title、sections（标题+内容）、providers（服务商列表）

export const DOC_TOPICS = {
  voice_asr: {
    id: 'voice_asr',
    title: '语音识别（ASR）配置指南',
    subtitle: 'Automatic Speech Recognition',
    icon: '🎤',
    summary: '语音识别将麦克风输入实时转为文字。首选推荐阿里云百炼 Paraformer（https://bailian.console.aliyun.com/）。也支持腾讯云、科大讯飞、火山引擎和本地 Whisper。配置入口：点击左上角 ⚙ → 语音设置。',
    sections: [
      {
        title: '为什么语音识别没有内容？',
        content: `常见原因：
① 未配置 ASR 密钥 — 云端 ASR 需要对应服务商的 API Key
② 麦克风权限未授予 — 请检查浏览器或系统麦克风权限
③ 本地 Whisper 模型未加载完成 — 首次下载 small 模型约 461 MB，需等待
④ 密钥填写错误或账户欠费 — 检查控制台报错信息`,
      },
      {
        title: '模式一：阿里云百炼 Paraformer（首选推荐，延迟低）',
        content: `小盾首选 ASR 方案，阿里云百炼实时语音识别，中文效果出色，延迟低。

配置字段（POST /settings/voice）：
■ aliyunApiKey — 阿里云百炼的 API Key（格式：sk-xxxxxxxxxxxxxxxx）

申请步骤：
1. 打开 https://bailian.console.aliyun.com/ 注册/登录
2. 完成阿里云账号实名认证（个人/企业均可）
3. 搜索「Paraformer」或「语音识别」，开通该模型服务（按平台使用规则开通）
4. 前往 API Key 管理页面，创建新的 API Key
5. 复制 API Key，在语音设置中填写 aliyunApiKey 字段

提醒：必须先完成认证 + 开通对应模型，未开通时调用会直接报错。

文档：https://help.aliyun.com/zh/model-studio/developer-reference/paraformer-v2`,
      },
      {
        title: '模式二：腾讯云 ASR',
        content: `腾讯云实时语音识别，支持粤语、英语等多语种。

配置字段（POST /settings/voice）：
■ tencentSecretId — 腾讯云访问密钥 ID
■ tencentSecretKey — 腾讯云访问密钥 Key
■ tencentAppId — 腾讯云 ASR 应用 AppId

申请步骤：
1. 打开 https://console.cloud.tencent.com/ 注册/登录
2. 进入「语音识别」产品，开通实时语音识别
3. 在 https://console.cloud.tencent.com/cam/capi 创建访问密钥
4. 记录 SecretId 和 SecretKey（两个都需要）
5. 在腾讯云 ASR 控制台找到你的 AppId
6. 在语音设置中填写以上三个字段

文档：https://cloud.tencent.com/document/product/1093/48982`,
      },
      {
        title: '模式三：科大讯飞 RTASR',
        content: `科大讯飞实时转写，中文识别老牌服务。

配置字段（POST /settings/voice）：
■ xunfeiAppId — 讯飞开放平台应用 AppID
■ xunfeiApiKey — 应用 API Key
■ xunfeiApiSecret — 应用 API Secret

申请步骤：
1. 打开 https://www.xfyun.cn/ 注册/登录讯飞开放平台
2. 控制台 → 创建应用 → 添加「实时语音转写（RTASR）」服务
3. 在应用详情页找到 AppID、APIKey、APISecret（三个都需要）
4. 在语音设置中填写以上三个字段

文档：https://www.xfyun.cn/doc/asr/rtasr/API.html`,
      },
    ],
    providers: [
      { name: '阿里云百炼 Paraformer（首选）', url: 'https://bailian.console.aliyun.com/', free: false, note: '首选推荐，延迟低，字段：aliyunApiKey（需先认证+开通模型）' },
      { name: '腾讯云 ASR', url: 'https://console.cloud.tencent.com/asr', free: false, note: '多语种，字段：tencentSecretId/Key/AppId' },
      { name: '科大讯飞 RTASR', url: 'https://www.xfyun.cn/', free: false, note: '中文老牌，字段：xunfeiAppId/ApiKey/ApiSecret' },
    ],
  },

  voice_config: {
    id: 'voice_config',
    title: '\u8bed\u97f3\u8f93\u5165\u4e0e\u8bc6\u522b\u914d\u7f6e',
    subtitle: 'Voice Input & ASR Settings',
    icon: '\ud83c\udfa4',
    summary: '\u5f53\u524d\u4ec5\u4fdd\u7559\u9ea6\u514b\u98ce\u8f93\u5165\u548c\u8bed\u97f3\u8bc6\u522b\uff0cAgent \u56de\u590d\u4ee5\u6587\u5b57\u663e\u793a\u3002\u914d\u7f6e\u5165\u53e3\uff1a\u8bbe\u7f6e \u2192 \u8bed\u97f3\u5bf9\u8bdd\u3002',
    sections: [
      {
        title: '\u5feb\u901f\u5f00\u59cb',
        content: `\u8bed\u97f3\u529f\u80fd\u4ec5\u5305\u542b\u8bed\u97f3\u8bc6\u522b\uff1a\n\u25a0 \u9ea6\u514b\u98ce \u2192 \u4e91\u7aef ASR \u8bc6\u522b \u2192 \u6587\u5b57\u8f93\u5165\n\u25a0 \u53ef\u914d\u7f6e\u8bc6\u522b\u670d\u52a1\u5546\u3001\u8bc6\u522b\u8bed\u8a00\u548c\u9ea6\u514b\u98ce\u8bbe\u5907\n\u25a0 Agent \u56de\u590d\u4ec5\u4ee5\u6587\u5b57\u663e\u793a\uff0c\u4e0d\u4f1a\u8fdb\u884c\u8bed\u97f3\u64ad\u62a5\u3002\n\n\u914d\u7f6e\u63a5\u53e3\uff1aPOST /settings/voice`,
      },
      {
        title: '\u4e3a\u4ec0\u4e48\u8bed\u97f3\u8bc6\u522b\u6ca1\u6709\u5185\u5bb9\uff1f',
        content: `\u5e38\u89c1\u539f\u56e0\uff1a\n\u2460 \u672a\u914d\u7f6e ASR \u5bc6\u94a5\uff1a\u4e91\u7aef ASR \u9700\u8981\u5bf9\u5e94\u670d\u52a1\u5546\u7684 API Key\n\u2461 \u9ea6\u514b\u98ce\u6743\u9650\u672a\u6388\u4e88\uff1a\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u6216\u7cfb\u7edf\u9ea6\u514b\u98ce\u6743\u9650\n\u2462 \u672c\u5730 Whisper \u6a21\u578b\u5c1a\u672a\u52a0\u8f7d\u5b8c\u6210\uff1a\u9996\u6b21\u4e0b\u8f7d\u9700\u7b49\u5f85\n\u2463 \u5bc6\u94a5\u586b\u5199\u9519\u8bef\u6216\u8d26\u6237\u4e0d\u53ef\u7528\uff1a\u68c0\u67e5\u63a7\u5236\u53f0\u62a5\u9519\u4fe1\u606f`,
      },
      {
        title: '\u914d\u7f6e\u540e\u5982\u4f55\u6d4b\u8bd5\uff1f',
        content: `\u2192 \u70b9\u51fb\u754c\u9762\u4e0a\u7684\u9ea6\u514b\u98ce\u6309\u94ae\uff0c\u5f00\u59cb\u8bf4\u8bdd\n\u2192 \u8bf4\u8bdd\u505c\u987f\u540e\uff0c\u8bc6\u522b\u6587\u5b57\u4f1a\u81ea\u52a8\u8fdb\u5165\u8f93\u5165\u6846\n\u2192 \u5982\u679c\u6ca1\u6709\u8bc6\u522b\u7ed3\u679c\uff0c\u4f9d\u6b21\u68c0\u67e5\u9ea6\u514b\u98ce\u6743\u9650\u3001\u670d\u52a1\u5546\u548c API Key`,
      },
    ],
    providers: [],
  },
}

// \u6839\u636e\u7528\u6237\u6d88\u606f\u5185\u5bb9\u68c0\u6d4b\u8bed\u97f3\u6587\u6863\u4e3b\u9898
export function detectDocTopic(text) {
  if (!text) return null
  const t = text.toLowerCase()
  if (/\u8bc6\u522b\u4e0d\u5230|\u6ca1\u6709?\u5185\u5bb9|\u6ca1\u6709?\u6587\u5b57|\u8bed\u97f3\u8bc6\u522b|\u914d\u7f6e.*\u8bc6\u522b|\u9ea6\u514b\u98ce|\bmic\b|\basr\b|paraformer|\u8baf\u98de|\u817e\u8baf.*\u8bed\u97f3|aliyun.*key|xunfei|tencent.*asr/.test(t)) {
    return 'voice_asr'
  }
  if (/(\u8bed\u97f3|\u58f0\u97f3).*(\u914d\u7f6e|\u8bbe\u7f6e|\u600e\u4e48|\u5982\u4f55|\u5f00\u542f)|(\u914d\u7f6e|\u8bbe\u7f6e).*(\u8bed\u97f3|\u58f0\u97f3)|\u8bed\u97f3\u529f\u80fd/.test(t)) {
    return 'voice_config'
  }
  return null
}

export function formatDocAsContext(topicId) {
  const doc = DOC_TOPICS[topicId]
  if (!doc) return ''
  const lines = [`## \u53c2\u8003\u6587\u6863\uff1a${doc.title}`, doc.summary, '']
  for (const section of doc.sections) {
    lines.push(`### ${section.title}`)
    lines.push(section.content)
    lines.push('')
  }
  if (doc.providers.length > 0) {
    lines.push('### \u670d\u52a1\u5546\u4e00\u89c8')
    for (const provider of doc.providers) {
      lines.push(`- **${provider.name}**${provider.free ? '\uff08\u6709\u514d\u8d39\u989d\u5ea6\uff09' : ''}\uff1a${provider.note} ? ${provider.url}`)
    }
  }
  return lines.join('\\n')
}
