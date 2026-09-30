'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../dist/room-link.js');
const { resolveRoom, extractLive, streamURL, ENTER_PARAMS } = require('../electron/dy-live.cjs');

test('accepts douyin web room urls and share short links', () => {
  const long = parse('https://live.douyin.com/776590209144?activity_name=&anchor_id=1171437962923852&category_name=all');
  assert.equal(long.liveId, '776590209144');
  assert.equal(long.platform, 'douyin');
  assert.deepEqual(parse('https://v.douyin.com/iAbCdEf/'), { url: 'https://v.douyin.com/iAbCdEf/', liveId: '', platform: 'douyin' });
  for (const url of [
    'https://live.douyin.com/',
    'https://live.douyin.com/abc',
    'https://v.douyin.com.evil.test/x',
    'http://live.douyin.com/776590209144',
    'https://user:pass@live.douyin.com/776590209144'
  ]) assert.throws(() => parse(url));
});

test('streamURL only accepts flv on douyincdn.com and upgrades to https', () => {
  assert.equal(streamURL('http://pull-flv-l26.douyincdn.com/third/stream-1_sd.flv?expire=x&sign=y'),
    'https://pull-flv-l26.douyincdn.com/third/stream-1_sd.flv?expire=x&sign=y');
  assert.equal(streamURL('https://douyincdn.com.evil.test/a.flv'), null);
  assert.equal(streamURL('https://pull-flv-l26.douyincdn.com/a.m3u8'), null);
});

const liveJson = { data: { data: [{ id_str: '7691205066917432100', web_rid: '776590209144', status: 2, title: '极氪7X上新',
  stream_url: { flv_pull_url: {
    FULL_HD1: 'http://pull-flv-l26.douyincdn.com/third/stream-1.flv?sign=a',
    SD2: 'http://pull-flv-l26.douyincdn.com/third/stream-1_sd.flv?sign=b' } } }] } };

test('extractLive prefers the lowest quality and treats non-live status as terminal', () => {
  const live = extractLive(liveJson, '776590209144');
  assert.equal(live.sourceURL, 'https://pull-flv-l26.douyincdn.com/third/stream-1_sd.flv?sign=b');
  assert.equal(live.title, '极氪7X上新');
  assert.equal(live.liveId, '7691205066917432100');
  const ended = liveJson.data.data[0]; ended.status = 4;
  assert.throws(() => extractLive(liveJson, '776590209144'), error => /未开播|结束/.test(error.message) && error.retryable === false);
  ended.status = 2;
  assert.throws(() => extractLive({ data: { data: [{ ...ended, web_rid: '111' }] } }, '776590209144'), /不一致/);
  assert.throws(() => extractLive({ data: { data: [{ ...ended, stream_url: {} }] } }, '776590209144'), /没有可用/);
});

test('resolveRoom follows share redirect, obtains ttwid, and calls enter with full params', async () => {
  let calls = 0;
  const headers = new Map();
  const fetchImpl = async (url, options) => {
    calls++;
    if (calls === 1) return { url: 'https://live.douyin.com/776590209144', headers: { getSetCookie: () => ['ttwid=abc123; Path=/; Secure'] }, body: { cancel: async () => {} } };
    if (calls === 2) return { url: 'https://live.douyin.com/776590209144', headers: { getSetCookie: () => [] }, body: { cancel: async () => {} } };
    assert.match(url, /^https:\/\/live\.douyin\.com\/webcast\/room\/web\/enter\//);
    assert.equal(options.headers.Cookie, 'ttwid=abc123');
    const params = new URL(url).searchParams;
    for (const key of Object.keys(ENTER_PARAMS)) assert.equal(params.get(key), ENTER_PARAMS[key], key);
    assert.equal(params.get('web_rid'), '776590209144');
    return { url, ok: true, status: 200, headers: { getSetCookie: () => [] }, text: async () => JSON.stringify(liveJson) };
  };
  const live = await resolveRoom('https://v.douyin.com/iAbCdEf/', { fetchImpl });
  assert.equal(calls, 3);
  assert.equal(live.sourceURL, 'https://pull-flv-l26.douyincdn.com/third/stream-1_sd.flv?sign=b');
});

test('empty soft-block responses and redirect misses are handled', async () => {
  await assert.rejects(resolveRoom('https://v.douyin.com/x/', {
    fetchImpl: async () => ({ url: 'https://www.iesdouyin.com/share/video/1/', headers: { getSetCookie: () => [] }, body: { cancel: async () => {} } })
  }), error => error.retryable === false && /不是有效的抖音直播间/.test(error.message));
  let calls = 0;
  await assert.rejects(resolveRoom('https://live.douyin.com/776590209144', {
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return { url: 'https://live.douyin.com/776590209144', headers: { getSetCookie: () => ['ttwid=t; Path=/'] }, body: { cancel: async () => {} } };
      return { url: 'https://live.douyin.com/webcast/room/web/enter/?web_rid=776590209144', ok: true, status: 200, headers: { getSetCookie: () => [] }, text: async () => '' };
    }
  }), error => error.retryable === true);
});
