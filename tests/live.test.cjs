'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../dist/room-link.js');
const { resolveRoom, extractLive, streamURL, openStream } = require('../electron/taobao-live.cjs');

test('accepts the reported follow link and preserves liveId as a string', () => {
  const url = 'https://tbzb.taobao.com/follow?spm=a21bo.29164009.discovery.1.15425f7eTovUbB&liveSource=pc_live.follow&liveId=653358385807746';
  assert.equal(parse(url).liveId, '653358385807746');
  assert.equal(parse(url).url, url);
  assert.equal(parse(url.replaceAll('&', '\\&').replace('pc_live', 'pc\\_live')).liveId, '653358385807746');
  assert.equal(parse('https://tbzb.taobao.com/live?liveId=123').liveId, '123');
});

test('rejects spoofed hosts, credentials, missing and ambiguous room IDs', () => {
  for (const url of [
    'https://tbzb.taobao.com.evil.test/follow?liveId=123',
    'https://user:pass@tbzb.taobao.com/follow?liveId=123',
    'https://tbzb.taobao.com/follow',
    'https://tbzb.taobao.com/follow?liveId=123&liveId=456',
    'https://tbzb.taobao.com/follow?liveId=NaN',
    'http://tbzb.taobao.com/follow?liveId=123',
    'file:///tmp/live?liveId=123'
  ]) assert.throws(() => parse(url));
});

const liveData = { id: '123', title: '直播间', roomStatus: 1, streamStatus: 1,
  liveUrl: 'http://liveng.alicdn.com/high.flv',
  liveUrlList: [{ definition: 'ld', flvUrl: 'http://liveng.alicdn.com/low.flv' }] };

test('selects a valid live FLV stream and refuses replay/offline data', () => {
  assert.equal(extractLive(liveData, '123').sourceURL, 'https://liveng.alicdn.com/low.flv');
  assert.throws(() => extractLive({ ...liveData, roomStatus: 2 }, '123'), /未开播|结束/);
  assert.throws(() => extractLive({ ...liveData, streamStatus: 0 }, '123'), /推流/);
  assert.throws(() => extractLive(liveData, '456'), /不一致/);
  assert.equal(streamURL('https://127.0.0.1/secret.flv'), null);
  assert.equal(streamURL('https://alicdn.com.evil.test/live.flv'), null);
  assert.equal(streamURL('https://liveng.alicdn.com/live.m3u8'), null);
});

test('anonymous token handshake retries once then parses the current room', async () => {
  let calls = 0;
  const result = await resolveRoom('https://tbzb.taobao.com/follow?liveId=123', { fetchImpl: async (url, options) => {
    calls++;
    const parsed = new URL(url);
    assert.equal(parsed.hostname, 'h5api.m.taobao.com');
    assert.equal(JSON.parse(parsed.searchParams.get('data')).liveId, '123');
    if (calls === 1) return new Response(JSON.stringify({ ret: ['FAIL_SYS_TOKEN_EMPTY::令牌为空'], data: {} }), {
      headers: { 'Set-Cookie': '_m_h5_tk=testtoken_123456; Path=/; Secure' }
    });
    assert.match(options.headers.Cookie, /_m_h5_tk=testtoken_123456/);
    return new Response(JSON.stringify({ ret: ['SUCCESS::调用成功'], data: liveData }));
  } });
  assert.equal(calls, 2);
  assert.equal(result.title, '直播间');
});

test('login or verification is reported without repeatedly retrying', async () => {
  let calls = 0;
  await assert.rejects(resolveRoom('https://tbzb.taobao.com/live?liveId=123', { fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ ret: ['FAIL_SYS_USER_VALIDATE::请验证'], data: {} }));
  } }), /登录或验证/);
  assert.equal(calls, 1);
});

test('follows Taobao CDN redirects and rejects redirects to private hosts', async () => {
  let calls = 0;
  const response = await openStream('https://liveng.alicdn.com/live.flv', { fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response(null, { status: 302, headers: { Location: 'https://edge.mobgslb.tbcache.com/live.flv' } }) : new Response('FLV');
  } });
  assert.equal(await response.text(), 'FLV');
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(openStream('https://liveng.alicdn.com/live.flv', { fetchImpl: async () => {
    calls++;
    return new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } });
  } }), /不支持/);
  assert.equal(calls, 1);
});
