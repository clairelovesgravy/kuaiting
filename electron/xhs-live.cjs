'use strict';

// 小红书直播解析：分享短链 → 直播间页 → __INITIAL_STATE__ → pullConfig 流地址。
// 页面可匿名访问，无需登录或签名；流地址同样匿名可拉（主/备 FLV + m3u8 兜底）。

const { parse } = require('../dist/room-link.js');
const PAGE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  Referer: 'https://www.xiaohongshu.com/'
};
const failure = (message, retryable = false) => Object.assign(new Error(message), { retryable });

function streamURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !(url.hostname === 'xhscdn.com' || url.hostname.endsWith('.xhscdn.com')) ||
      !url.pathname.toLowerCase().endsWith('.flv')) return null;
    url.protocol = 'https:';
    return url.href;
  } catch { return null; }
}

// 页面里是 JS 字面量而非严格 JSON：字符串感知地找平衡边界，裸 undefined 洗成 null。
function extractState(html) {
  const at = html.indexOf('__INITIAL_STATE__');
  if (at < 0) throw failure('小红书页面数据不完整，请重试。');
  const start = html.indexOf('{', at);
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (!depth) {
        try { return JSON.parse(html.slice(start, i + 1).replace(/:undefined(?=[,}])/g, ':null')); }
        catch { throw failure('小红书页面数据不完整，请重试。'); }
      }
    }
  }
  throw failure('小红书页面数据不完整，请重试。');
}

function extractLive(state, expectedId) {
  const live = state?.liveStream;
  if (!live || typeof live !== 'object') throw failure('小红书返回的直播间信息不完整，请重试。');
  if (live.pageStatus !== 'success' || live.errorMessage) {
    throw failure(String(live.errorMessage || '这个直播间暂时无法收听，可能已结束。'));
  }
  const roomData = live.roomData || {};
  const room = roomData.roomInfo || {};
  const roomId = String(room.roomId || expectedId || '');
  if (expectedId && roomId !== expectedId) throw failure('返回的直播间与链接不一致，已停止连接。');
  let variants = [];
  try { variants = JSON.parse(room.pullConfig || '{}'); } catch {}
  const urls = [...(variants.h264 || []), ...(variants.h265 || [])]
    .map(item => item?.master_url).map(streamURL).filter(Boolean);
  const unique = [...new Set(urls)];
  if (!unique.length) throw failure('这个直播间没有可用的音频来源，可能已下播。');
  const title = String(room.roomTitle || roomData.hostInfo?.nickName || '小红书直播间').slice(0, 120);
  return { liveId: roomId, title, sourceURL: unique[0], rtcURL: null };
}

async function resolveRoom(value, { signal, fetchImpl = fetch } = {}) {
  let link;
  try { link = parse(value); } catch (error) { throw failure(error.message); }
  let roomURL = link.url;
  const timeout = outer => outer ? AbortSignal.any([outer, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000);
  if (!link.liveId) {
    // 分享短链：跟随重定向拿最终直播间地址（跟随数量由 fetch 自身限制）。
    const response = await fetchImpl(roomURL, { headers: PAGE_HEADERS, redirect: 'follow', signal: timeout(signal) });
    await response.body?.cancel().catch(() => {});
    roomURL = response.url || '';
    const match = roomURL.match(/^https:\/\/(?:www\.)?xiaohongshu\.com\/livestream\/[^/]+\/(\d{1,30})/);
    if (!match) throw failure('这个分享链接不是有效的直播间，请在小红书进入直播间后重新分享。');
    link = { url: roomURL, liveId: match[1], platform: 'xhs' };
  }
  const page = await fetchImpl(roomURL, { headers: PAGE_HEADERS, redirect: 'error', signal: timeout(signal) });
  if (!page.ok) throw failure(`小红书页面请求失败（HTTP ${page.status}）。`, page.status >= 500 || page.status === 408 || page.status === 429);
  const html = await page.text();
  if (html.length > 4 * 1024 * 1024) throw failure('小红书页面响应过大，已停止连接。');
  return extractLive(extractState(html), link.liveId);
}

module.exports = { resolveRoom, extractLive, extractState, streamURL, PAGE_HEADERS };
