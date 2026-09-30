'use strict';

const { createHash } = require('node:crypto');
const { parse } = require('../dist/room-link.js');
const API = 'https://h5api.m.taobao.com/h5/mtop.roomstudio.live.detail.get/1.0/';
const APP_KEY = '34675810';
const REQUEST_HEADERS = { Referer: 'https://tbzb.taobao.com/', 'User-Agent': 'Mozilla/5.0' };
const failure = (message, retryable = false) => Object.assign(new Error(message), { retryable });

function streamURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port ||
      !(url.hostname === 'alicdn.com' || url.hostname.endsWith('.alicdn.com')) || !url.pathname.toLowerCase().endsWith('.flv')) return null;
    url.protocol = 'https:';
    return url.href;
  } catch { return null; }
}

function rtcURL(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'artc:' || url.username || url.password || url.port ||
      !(url.hostname === 'taobao.com' || url.hostname.endsWith('.taobao.com'))) return null;
    return url.href;
  } catch { return null; }
}

function extractLive(data, expectedId) {
  if (!data || typeof data !== 'object') throw failure('淘宝返回的直播间信息不完整，请重试。');
  const returnedId = String(data.liveId || data.id || '');
  if (returnedId && returnedId !== expectedId) throw failure('返回的直播间与链接不一致，已停止连接。');
  if (String(data.roomStatus) !== '1') throw failure('该直播间当前未开播或已经结束，请换一个正在直播的链接。');
  if (String(data.streamStatus) !== '1') throw failure('主播暂未推流，正在尝试恢复。', true);
  const variants = Array.isArray(data.liveUrlList) ? data.liveUrlList : [];
  const urls = [...variants.filter(item => item?.definition === 'ld').map(item => item.flvUrl),
    data.liveUrl, ...variants.map(item => item?.flvUrl)].map(streamURL).filter(Boolean);
  if (!urls.length) throw failure('这个直播间没有可用的 FLV 音频来源，暂时无法收听。');
  // ARTC 超低延时流优先选 md（720p）档；只在需要兜底时用 FLV。
  const rtc = [variants.find(item => item?.definition === 'md')?.rtcLiveUrl,
    ...variants.map(item => item?.rtcLiveUrl), data.rtcLiveUrl].map(rtcURL).find(Boolean) || null;
  return { liveId: expectedId, title: String(data.title || '淘宝直播间').slice(0, 120), sourceURL: urls[0], rtcURL: rtc };
}

async function resolveRoom(value, { signal, fetchImpl = fetch } = {}) {
  let liveId;
  try { ({ liveId } = parse(value)); } catch (error) { throw failure(error.message); }
  const data = JSON.stringify({ liveId, productType: 'live', liveSource: 'source_pc_live', entryLiveSource: 'source_pc_live', useLiveFandom: false });
  // Use only the anonymous H5 session issued by this endpoint; no browser/account cookies.
  const cookies = new Map();
  for (let attempt = 0; attempt < 2; attempt++) {
    const timestamp = String(Date.now());
    const token = (cookies.get('_m_h5_tk') || 'undefined').split('_')[0];
    const sign = createHash('md5').update(`${token}&${timestamp}&${APP_KEY}&${data}`).digest('hex');
    const params = new URLSearchParams({ jsv: '2.7.2', appKey: APP_KEY, t: timestamp, sign,
      api: 'mtop.roomstudio.live.detail.get', v: '1.0', type: 'originaljson', dataType: 'json', data });
    const headers = { ...REQUEST_HEADERS };
    if (cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    const response = await fetchImpl(`${API}?${params}`, { headers, redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000) });
    if (!response.ok) throw failure(`淘宝直播连接失败（HTTP ${response.status}），请稍后重试。`, response.status >= 500 || response.status === 408);
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';', 1)[0], at = pair.indexOf('=');
      if (at > 0 && ['_m_h5_tk', '_m_h5_tk_enc'].includes(pair.slice(0, at))) cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    const text = await response.text();
    if (text.length > 4 * 1024 * 1024) throw failure('直播间响应过大，已停止连接。');
    let result;
    try { result = JSON.parse(text); } catch { throw failure('淘宝返回了验证页面，当前无法直接解析，请在淘宝确认能正常观看。'); }
    const ret = Array.isArray(result.ret) ? result.ret.map(String) : [];
    if (ret.some(item => item.startsWith('SUCCESS::'))) return extractLive(result.data, liveId);
    if (!attempt && ret.some(item => /FAIL_SYS_TOKEN_(EMPTY|EXOIRED|EXPIRED)/.test(item)) && cookies.has('_m_h5_tk')) continue;
    if (ret.some(item => /SESSION_EXPIRED|NEED_LOGIN|LOGIN|USER_VALIDATE|RGV587|ACCESS_DENIED|ILLEGAL_ACCESS/.test(item))) {
      throw failure('淘宝要求登录或验证，当前无法直接收听这个直播间。请先在淘宝网页确认直播状态。');
    }
    throw failure('淘宝未提供可播放的直播信息，请确认直播仍在进行后重试。');
  }
  throw failure('直播连接失败，请重试。', true);
}

async function openStream(sourceURL, { signal, fetchImpl = fetch } = {}) {
  let url = new URL(sourceURL);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['alicdn.com', 'tbcache.com', 'xhscdn.com', 'douyincdn.com'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))) {
      throw new Error('直播流跳转到了不支持的地址。');
    }
    // 各平台 CDN 的请求头：淘宝维持网页版 Referer；小红书不需要；抖音带网页 Referer。
    const headers = url.hostname.endsWith('xhscdn.com') ? { 'User-Agent': REQUEST_HEADERS['User-Agent'] } :
      url.hostname.endsWith('douyincdn.com') ? { 'User-Agent': REQUEST_HEADERS['User-Agent'], Referer: 'https://live.douyin.com/' } : REQUEST_HEADERS;
    const response = await fetchImpl(url.href, { headers, redirect: 'manual', signal });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    await response.body?.cancel();
    if (!location) throw new Error('直播流缺少跳转地址。');
    url = new URL(location, url);
  }
  throw new Error('直播流跳转次数过多，请重试。');
}

module.exports = { resolveRoom, extractLive, streamURL, rtcURL, openStream, REQUEST_HEADERS };
