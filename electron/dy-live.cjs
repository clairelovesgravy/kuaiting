'use strict';

// 抖音直播解析：网页版房间（live.douyin.com/<rid>）或 App 分享短链（v.douyin.com）。
// 匿名两步：任意页面拿 ttwid cookie → webcast/room/web/enter/ 拿房间信息与 FLV 地址。
// 注意：enter 接口的查询参数必须完整（浏览器环境指纹），参数缺失会返回 200 + 空 body 的软封锁。

const { parse } = require('../dist/room-link.js');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const ENTER_PARAMS = {
  aid: '6383', app_name: 'douyin_web', live_id: '1', device_platform: 'web', language: 'zh-CN',
  enter_from: 'web_live', cookie_enabled: 'true', screen_width: '1920', screen_height: '1080',
  browser_language: 'zh-CN', browser_platform: 'MacIntel', browser_name: 'Chrome', browser_version: '126.0.0.0',
  room_id_str: '', enter_source: '', is_need_double_stream: 'false', insert_task_id: '', live_reason: ''
};
// 清晰度从低到高：听声音优先省流量。
const QUALITY_ORDER = ['SD2', 'SD1', 'HD1', 'FULL_HD1', 'ORIGION'];
const failure = (message, retryable = false) => Object.assign(new Error(message), { retryable });

function streamURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !(url.hostname === 'douyincdn.com' || url.hostname.endsWith('.douyincdn.com')) ||
      !url.pathname.toLowerCase().endsWith('.flv')) return null;
    url.protocol = 'https:';
    return url.href;
  } catch { return null; }
}

function extractLive(json, expectedRid) {
  const room = json?.data?.data?.[0];
  if (!room || typeof room !== 'object') throw failure('抖音返回的直播间信息不完整，请重试。');
  const returnedRid = String(room.web_rid || '');
  if (expectedRid && returnedRid && returnedRid !== expectedRid) throw failure('返回的直播间与链接不一致，已停止连接。');
  if (String(room.status) !== '2') throw failure('该直播间当前未开播或已经结束，请换一个正在直播的链接。');
  const flv = room.stream_url?.flv_pull_url;
  const url = QUALITY_ORDER.map(q => flv?.[q]).map(streamURL).find(Boolean) ||
    Object.values(flv || {}).map(streamURL).find(Boolean);
  if (!url) throw failure('这个直播间没有可用的 FLV 音频来源，暂时无法收听。');
  return { liveId: String(room.id_str || expectedRid || ''), title: String(room.title || '抖音直播间').slice(0, 120), sourceURL: url, rtcURL: null };
}

function ttwidFrom(response) {
  for (const cookie of response.headers?.getSetCookie?.() || []) {
    if (cookie.startsWith('ttwid=')) return cookie.split(';')[0].slice(6);
  }
  return '';
}

async function resolveRoom(value, { signal, fetchImpl = fetch } = {}) {
  let link;
  try { link = parse(value); } catch (error) { throw failure(error.message); }
  let rid = link.liveId;
  const timeout = outer => outer ? AbortSignal.any([outer, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
  let redirectTtwid = '';
  if (!rid) {
    // App 分享短链：跟随重定向到 live.douyin.com/<rid>。
    const response = await fetchImpl(link.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: timeout(signal) });
    await response.body?.cancel().catch(() => {});
    redirectTtwid = ttwidFrom(response);
    const match = String(response.url || '').match(/^https:\/\/live\.douyin\.com\/(\d{6,20})/);
    if (!match) throw failure('这个分享链接不是有效的抖音直播间，请在抖音进入直播间后重新分享。');
    rid = match[1];
  }
  // 第一步：任意直播页面拿匿名 ttwid。
  const page = await fetchImpl(`https://live.douyin.com/${rid}`, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: timeout(signal) });
  await page.body?.cancel().catch(() => {});
  const ttwid = redirectTtwid || ttwidFrom(page);
  // 第二步：完整参数调 enter 接口。
  const params = new URLSearchParams({ ...ENTER_PARAMS, web_rid: rid });
  const response = await fetchImpl(`https://live.douyin.com/webcast/room/web/enter/?${params}`, {
    headers: { 'User-Agent': UA, Referer: `https://live.douyin.com/${rid}`, ...(ttwid ? { Cookie: `ttwid=${ttwid}` } : {}) },
    redirect: 'error', signal: timeout(signal)
  });
  if (!response.ok) throw failure(`抖音直播连接失败（HTTP ${response.status}），请稍后重试。`, response.status >= 500 || response.status === 408 || response.status === 429);
  const text = await response.text();
  if (!text.length) throw failure('抖音暂时没有返回直播间信息，请稍后重试。', true);
  if (text.length > 4 * 1024 * 1024) throw failure('抖音直播响应过大，已停止连接。');
  let json;
  try { json = JSON.parse(text); } catch { throw failure('抖音返回了验证页面，请稍后重试。'); }
  return extractLive(json, rid);
}

module.exports = { resolveRoom, extractLive, streamURL, ENTER_PARAMS, UA };
