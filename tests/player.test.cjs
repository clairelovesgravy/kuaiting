'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function clock() {
  let now = 0, id = 0; const tasks = new Map();
  const add = (fn, delay, repeat = 0) => { tasks.set(++id, { fn, at: now + delay, repeat }); return id; };
  return { now: () => now, setTimeout: (f, d) => add(f, d), clearTimeout: i => tasks.delete(i),
    setInterval: (f, d) => add(f, d, d), clearInterval: i => tasks.delete(i),
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const next = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        const [i, task] = next; now = task.at;
        if (task.repeat) task.at += task.repeat; else tasks.delete(i);
        task.fn(); await flush();
      }
      now = end; await flush();
    }, tasks };
}
function harness(options = {}) {
  const time = clock(), states = [], audios = [], engines = [], listeners = new Map(); let calls = 0;
  const result = { ok: true, title: 'test', liveId: '123', streamURL: 'kuaiting-stream://live/test', ...options.result };
  const bridge = { stopLive: async () => {}, resolveLive: async url => { calls++; return options.resolve ? options.resolve(url, calls) : result; } };
  const win = { addEventListener: (n, f) => listeners.set(n, f), removeEventListener: n => listeners.delete(n),
    AliRTS: options.rtc, mpegts: { getFeatureList: () => ({ mseLivePlayback: options.supported !== false }),
      Events: { ERROR: 'error', MEDIA_INFO: 'info' }, ErrorTypes: { NETWORK_ERROR: 'network' },
      createPlayer: () => {
        const handlers = {};
        const engine = { on: (n, f) => handlers[n] = f, handlers,
          attachMediaElement: a => engine.audio = a, load() {}, destroy() { engine.destroyed = true; },
          async play() { if (options.playError) throw options.playError; engine.audio.paused = false; engine.audio.onplaying?.(); } };
        engines.push(engine); return engine;
      } } };
  const makeAudio = () => {
    const audio = { currentTime: 0, readyState: 4, paused: true, seeking: false,
      buffered: { length: 1, start: () => 0, end: () => 2 }, pause() { this.paused = true; }, removeAttribute() {}, load() {}, remove() { this.removed = true; } };
    audios.push(audio); return audio;
  };
  const context = { window: win, performance: { now: time.now },
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    setInterval: time.setInterval, clearInterval: time.clearInterval };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/live-player.js'), 'utf8'), context);
  const player = new win.KuaitingLivePlayer((state, details) => states.push({ state, details }), {
    clock: time, bridge, makeAudio, online: options.online || (() => true)
  });
  return { player, time, states, audios, engines, listeners, calls: () => calls };
}

test('unsupported decoder and rejected play promise become visible terminal errors', async () => {
  for (const options of [{ supported: false }, { playError: Object.assign(new Error('blocked'), { name: 'NotAllowedError' }) }]) {
    const h = harness(options); await h.player.connect('test');
    assert.equal(h.states.at(-1).state, 'error');
    await h.time.advance(60000); assert.equal(h.calls(), 1); h.player.dispose();
  }
});

test('transient failures stop after three retries; permanent failures never retry', async () => {
  const h = harness({ resolve: async () => ({ ok: false, retryable: true, error: 'network' }) });
  await h.player.connect('test'); await h.time.advance(20000);
  assert.equal(h.calls(), 4); assert.equal(h.player.state, 'error');
  const permanent = harness({ resolve: async () => ({ ok: false, retryable: false, error: 'verify' }) });
  await permanent.player.connect('test'); await permanent.time.advance(60000);
  assert.equal(permanent.calls(), 1); assert.equal(permanent.player.state, 'error');
});

test('stopping cancels scheduled retry and invalidates late room responses', async () => {
  const h = harness({ resolve: async () => ({ ok: false, retryable: true, error: 'network' }) });
  await h.player.connect('test'); h.player.stop(); await h.time.advance(20000); assert.equal(h.calls(), 1);
  let release;
  const late = harness({ resolve: () => new Promise(resolve => release = resolve) });
  const pending = late.player.connect('test'); late.player.stop(); release({ ok: true, title: 'old', liveId: '123' }); await pending;
  assert.equal(late.engines.length, 0); assert.equal(late.player.intent, 'stopped');
});

test('offline waits without consuming retries and online resumes automatically', async () => {
  let online = false;
  const h = harness({ online: () => online }); await h.player.connect('test');
  await h.time.advance(60000); assert.equal(h.calls(), 0); assert.equal(h.player.state, 'reconnecting');
  online = true; h.listeners.get('online')(); await h.time.advance(500);
  assert.equal(h.calls(), 1); assert.equal(h.player.state, 'playing'); h.player.dispose();
});

test('old player callbacks cannot interrupt a new room', async () => {
  const h = harness(); await h.player.connect('one'); const old = h.engines[0];
  await h.player.connect('two'); old.handlers.error('network');
  assert.equal(h.player.state, 'playing'); assert.equal(h.player.retryCount, 0); h.player.dispose();
});

test('buffering watchdog is not postponed by repeated waiting events', async () => {
  const h = harness(); await h.player.connect('test'); const audio = h.audios[0];
  audio.onwaiting(); await h.time.advance(4000); audio.onwaiting(); await h.time.advance(4000);
  assert.equal(h.player.state, 'reconnecting'); h.player.dispose();
});

test('stalled playback triggers automatic reconnection', async () => {
  const h = harness(); await h.player.connect('test');
  await h.time.advance(11000);
  assert.ok(h.states.some(s => s.state === 'reconnecting')); assert.ok(h.calls() >= 2); h.player.dispose();
});

test('RTC falls back if subscribed but silent, and late RTC errors cannot kill FLV', async () => {
  const handlers = {};
  const rtc = { createClient: () => ({ on: (name, fn) => handlers[name] = fn,
    subscribe: async () => ({ hasAudio: true, disableVideo() {}, play() {} }), unsubscribe() {}, dispose() {} }) };
  const h = harness({ rtc, result: { rtcURL: 'artc://example.test/live' } });
  const pending = h.player.connect('test'); await flush();
  assert.equal(h.player.state, 'buffering'); await h.time.advance(9000); await pending;
  assert.equal(h.player.state, 'playing'); assert.equal(h.engines.length, 1);
  handlers.onError(); assert.equal(h.player.state, 'playing'); h.player.dispose();
});

test('pausing cancels a pending RTC subscription and all its timers', async () => {
  let resolve;
  const rtc = { createClient: () => ({ on() {}, subscribe: () => new Promise(r => resolve = r), unsubscribe() {}, dispose() {} }) };
  const h = harness({ rtc, result: { rtcURL: 'artc://example.test/live' } });
  const pending = h.player.connect('test'); await flush(); h.player.pause(); await pending;
  resolve({ hasAudio: true, disableVideo() { throw new Error('stale'); }, play() {} });
  await flush(); await h.time.advance(20000);
  assert.equal(h.player.state, 'paused'); assert.equal(h.engines.length, 0); assert.equal(h.time.tasks.size, 0);
});

test('default clock survives receiver-sensitive native timers (illegal invocation regression)', () => {
  const time = clock();
  const strict = fn => function (...args) { if (this && this !== globalThis) throw new TypeError('Illegal invocation'); return fn(...args); };
  const win = { addEventListener() {}, removeEventListener() {} };
  const context = { window: win, performance: { now: time.now },
    setTimeout: strict(time.setTimeout), clearTimeout: strict(time.clearTimeout),
    setInterval: strict(time.setInterval), clearInterval: strict(time.clearInterval) };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/live-player.js'), 'utf8'), context);
  const player = new win.KuaitingLivePlayer(() => {}, { makeAudio: () => ({ buffered: { length: 0 }, pause() {}, removeAttribute() {}, load() {}, remove() {} }) });
  player.stop();  // 旧实现在此处以 Illegal invocation 抛出
  player.dispose();
});
