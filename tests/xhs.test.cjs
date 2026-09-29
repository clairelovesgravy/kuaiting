'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse } = require('../dist/room-link.js');
const { resolveRoom, extractLive, extractState, streamURL } = require('../electron/xhs-live.cjs');

test('accepts xhs share short links and live room urls, keeps taobao behavior', () => {
  assert.deepEqual(parse('https://xhslink.com/o/AfdeACjE7W4'), { url: 'https://xhslink.com/o/AfdeACjE7W4', liveId: '', platform: 'xhs' });
  const long = parse('https://www.xiaohongshu.com/livestream/dynpathiqkWVxLb/570474374702409076?xsec_token=abc&xsec_source=app_share');
  assert.equal(long.liveId, '570474374702409076');
  assert.equal(long.platform, 'xhs');
  assert.equal(parse('https://tbzb.taobao.com/live?liveId=123').platform, 'taobao');
  for (const url of [
    'https://xhslink.com.evil.test/o/abc',
    'https://www.xiaohongshu.com/livestream/123',
    'https://www.xiaohongshu.com/explore/6511f9cb000000000803e',
    'http://xhslink.com/o/abc',
    'https://user:pass@xhslink.com/o/abc'
  ]) assert.throws(() => parse(url));
});

test('extracts the link when a whole share message is pasted', () => {
  const share = '小红书，你的生活指南#六舒翡翠闲置正在直播，来和我一起支持ta吧。 https://xhslink.com/o/1eY27L9oxRM 复制本条信息，打开【小红书】，直接观看直播！';
  const parsed = parse(share);
  assert.equal(parsed.platform, 'xhs');
  assert.equal(parsed.url, 'https://xhslink.com/o/1eY27L9oxRM');
  assert.equal(parse('看看这个 https://tbzb.taobao.com/live?liveId=123 蛮好的').liveId, '123');
  assert.throws(() => parse('这段话里根本没有链接，来和我一起支持ta吧。'), /请粘贴完整的直播间链接/);
});

test('streamURL only accepts flv on xhscdn.com and upgrades to https', () => {
  assert.equal(streamURL('http://live-source-play.xhscdn.com/live/1.flv'), 'https://live-source-play.xhscdn.com/live/1.flv');
  assert.equal(streamURL('http://live.xhscdn.com/live/1.flv'), 'https://live.xhscdn.com/live/1.flv');
  assert.equal(streamURL('https://xhscdn.com.evil.test/1.flv'), null);
  assert.equal(streamURL('https://live-source-play.xhscdn.com/live/1.m3u8'), null);
  assert.equal(streamURL('https://user@live.xhscdn.com/1.flv'), null);
});

const pullConfig = JSON.stringify({ h264: [
  { master_url: 'http://live-source-play.xhscdn.com/live/123.m3u8', quality_type_name: '原画' },
  { master_url: 'http://live-source-play.xhscdn.com/live/123.flv', quality_type_name: '原画' },
  { master_url: 'http://live-source-play-bak-tx.xhscdn.com/live/123.flv', quality_type_name: '原画' }
] });
function fixtureHtml({ pageStatus = 'success', errorMessage = '', pull = pullConfig, roomId = '123' } = {}) {
  const state = { global: { launchAppConfig: '{"dslVersion": 1, "brace": "inside string } ok"}' },
    liveStream: { pageStatus, errorMessage, roomData: {
      hostInfo: { nickName: '主播名' }, roomInfo: { roomId, roomTitle: '测试直播间', pullConfig: pull }, status: 2 } } };
  const json = JSON.stringify(state).replace('"status":2', '"status":2,"noteBackProfile":undefined');
  return `<html><body><script>window.__INITIAL_STATE__=${json}</script><script src="x.js"></script></body></html>`;
}

test('extractLive picks the first FLV and reports ended rooms as terminal', () => {
  const state = extractState(fixtureHtml());
  assert.equal(state.liveStream.pageStatus, 'success');
  const live = extractLive(state, '123');
  assert.equal(live.liveId, '123');
  assert.equal(live.title, '测试直播间');
  assert.equal(live.sourceURL, 'https://live-source-play.xhscdn.com/live/123.flv');
  assert.throws(() => extractLive(extractState(fixtureHtml({ pageStatus: 'error', errorMessage: '直播已结束' })), '123'),
    error => /直播已结束/.test(error.message) && error.retryable === false);
  assert.throws(() => extractLive(extractState(fixtureHtml({ pull: '{}' })), '123'), /没有可用/);
  assert.throws(() => extractLive(extractState(fixtureHtml({ pull: JSON.stringify({ h264: [{ master_url: 'https://evil.test/1.flv' }] }) })), '123'), /没有可用/);
  assert.throws(() => extractLive(state, '456'), /不一致/);
});

test('resolves a share short link through its redirect to the live page', async () => {
  let calls = 0;
  const final = 'https://www.xiaohongshu.com/livestream/dynpath/123?xsec_token=t';
  const live = await resolveRoom('https://xhslink.com/o/A', { fetchImpl: async url => {
    calls++;
    if (calls === 1) return { url: final, ok: true, status: 200, body: { cancel: async () => {} }, text: async () => '' };
    assert.equal(url, final);
    return { url: final, ok: true, status: 200, text: async () => fixtureHtml() };
  } });
  assert.equal(calls, 2);
  assert.equal(live.liveId, '123');
  assert.equal(live.sourceURL, 'https://live-source-play.xhscdn.com/live/123.flv');
});

test('redirects to non-live pages and server errors are handled', async () => {
  await assert.rejects(resolveRoom('https://xhslink.com/o/A', { fetchImpl: async () => ({ url: 'https://www.xiaohongshu.com/explore/6511f', ok: true, status: 200, body: { cancel: async () => {} }, text: async () => '' }) }), /不是有效的直播间/);
  await assert.rejects(resolveRoom('https://www.xiaohongshu.com/livestream/dynpath/123', {
    fetchImpl: async () => ({ url: 'https://www.xiaohongshu.com/livestream/dynpath/123', ok: false, status: 503, text: async () => '' })
  }), error => error.retryable === true);
});
