// 诈骗案例与套路情报工具：fraud_intel
//
// 供 LLM 在对话中主动调用，提供三个 action：
//   - fetch:  采集最新诈骗情报（从公开渠道搜索），返回结构化案例列表
//   - list:   查看已缓存的情报摘要（不联网，快速返回）
//   - push:   把指定情报整理成推送摘要，供 LLM 通过 send_message 主动推给用户
//
// 采集逻辑在 src/fraud-intel.js（与 trending.js 同构），此处只做参数校验和结果格式化。

import {
  collectFraudIntel,
  getFraudIntelCache,
  getFraudCategories,
} from '../../fraud-intel.js'
import { getAllClawbotTokens } from '../../db.js'
import { dispatchSocialMessage } from '../../social/dispatch.js'

function toolJson(obj, ok = true) {
  return JSON.stringify({ ok, ...obj }, null, 2)
}

/**
 * 执行诈骗情报工具。
 * @param {Object} args
 * @param {string} args.action  fetch | list | push
 * @param {boolean} [args.force]  fetch 时是否强制刷新缓存
 * @param {string[]} [args.category_ids]  限定采集/推送的类型
 * @param {number} [args.limit]  push 时推送几条
 * @returns {Promise<string>} JSON 字符串
 */
export async function execFraudIntel(args = {}) {
  const action = String(args.action || 'list').trim().toLowerCase()

  // ─── fetch：联网采集 ───
  if (action === 'fetch') {
    try {
      const result = await collectFraudIntel({
        force: !!args.force,
        categoryIds: Array.isArray(args.category_ids) ? args.category_ids : [],
      })
      return toolJson({
        action: 'fetch',
        fetched_at: result.fetched_at,
        search_engine: result.search_engine,
        total_cases: result.total_cases,
        categories: result.categories.map(c => ({
          type: c.type,
          id: c.id,
          case_count: c.cases.length,
          cases: c.cases.map(item => ({
            title: item.title,
            summary: item.summary?.slice(0, 300) || '',
            source: item.source,
            url: item.url,
          })),
        })),
        hint: '情报已采集并缓存。发现与用户当前对话相关的骗局手法时，应主动提醒。可用 action=push 把情报推送给用户。',
      })
    } catch (err) {
      return toolJson({
        action: 'fetch',
        error: `采集失败: ${err.message}`,
        hint: '网络可能不可用或搜索引擎被限流。稍后重试，或用 action=list 查看已有缓存。',
      }, false)
    }
  }

  // ─── list：查看缓存摘要 ───
  if (action === 'list') {
    const cache = getFraudIntelCache()
    if (!cache) {
      return toolJson({
        action: 'list',
        empty: true,
        message: '暂无缓存的诈骗情报。用 action=fetch 采集最新情报。',
        available_categories: getFraudCategories(),
      })
    }
    const categoryIds = Array.isArray(args.category_ids) ? args.category_ids : []
    const cats = categoryIds.length > 0
      ? cache.categories.filter(c => categoryIds.includes(c.id))
      : cache.categories
    return toolJson({
      action: 'list',
      fetched_at: cache.fetched_at,
      total_cases: cache.total_cases,
      categories: cats.map(c => ({
        id: c.id,
        type: c.type,
        case_count: c.cases.length,
        cases: c.cases.map(item => ({
          title: item.title,
          summary: item.summary?.slice(0, 200) || '',
          source: item.source,
          url: item.url,
        })),
      })),
      hint: '如需推送给用户，调 action=push。如需刷新，调 action=fetch。',
    })
  }

  // ─── push：生成推送摘要 ───
  if (action === 'push') {
    const cache = getFraudIntelCache()
    if (!cache) {
      return toolJson({
        action: 'push',
        error: '暂无缓存的诈骗情报。先调 action=fetch 采集。',
      }, false)
    }
    const limit = Math.max(1, Math.min(Number(args.limit) || 3, 8))
    const categoryIds = Array.isArray(args.category_ids) ? args.category_ids : []
    const cats = categoryIds.length > 0
      ? cache.categories.filter(c => categoryIds.includes(c.id))
      : cache.categories

    const pushes = []
    for (const cat of cats) {
      for (const item of cat.cases.slice(0, limit)) {
        pushes.push({
          type: cat.type,
          title: item.title,
          summary: item.summary?.slice(0, 300) || '',
          source: item.source,
          url: item.url,
        })
      }
      if (pushes.length >= limit * cats.length) break
    }

    if (pushes.length === 0) {
      return toolJson({
        action: 'push',
        empty: true,
        message: '指定类型下暂无案例。换 category_ids 或调 action=fetch 采集。',
      })
    }

    // 生成可直接推给用户的文本摘要
    const textLines = ['【最新诈骗情报提醒】', '']
    for (const p of pushes) {
      textLines.push(`■ ${p.type}：${p.title}`)
      if (p.summary) textLines.push(`  ${p.summary.slice(0, 200)}`)
      if (p.url) textLines.push(`  详情: ${p.url}`)
      textLines.push('')
    }
    textLines.push('> 以上为系统自动采集的最新诈骗案例，请提高警惕。如有疑问请拨打 96110。')

    const pushText = textLines.join('\n')

    // 同步推送到所有已绑定的微信会话（clawbot）
    const tokens = getAllClawbotTokens()
    const wechatResults = []
    for (const { from_user_id } of tokens) {
      try {
        const r = await dispatchSocialMessage(`wechat:clawbot:${from_user_id}`, { text: pushText })
        wechatResults.push({ user: from_user_id, ok: !!r?.ok, reason: r?.reason || r?.error || null })
      } catch (err) {
        wechatResults.push({ user: from_user_id, ok: false, reason: err.message })
      }
    }

    return toolJson({
      action: 'push',
      push_count: pushes.length,
      items: pushes,
      push_text: pushText,
      wechat_pushed: wechatResults.filter(r => r.ok).length,
      wechat_total: tokens.length,
      wechat_results: wechatResults,
      hint: wechatResults.some(r => r.ok)
        ? `已推送 ${wechatResults.filter(r => r.ok).length} 个微信会话。可在对话中告知用户"反诈提醒已发到您微信"。`
        : (tokens.length === 0
          ? '暂无绑定的微信会话，推送文案已在下方，可直接回复用户。'
          : '微信推送未成功，推送文案已在下方，可直接回复用户。'),
    })
  }

  return toolJson({
    error: `不支持的 action: "${action}"`,
    supported_actions: ['fetch', 'list', 'push'],
    available_categories: getFraudCategories(),
  }, false)
}
