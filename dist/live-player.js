'use strict';

class KuaitingLivePlayer {
  constructor(onState, options = {}) {
    this.onState = onState;
    // 注入点仅服务于测试；默认实现必须绑定原生定时器，裸引用会以 Illegal invocation 抛出。
    this.clock = options.clock || { now: () => performance.now(),
      setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args),
      setInterval: (...args) => setInterval(...args), clearInterval: (...args) => clearInterval(...args) };
    this.bridge = options.bridge || window.kuaitingDesktop;
    this.makeAudio = options.makeAudio || (() => { const a = document.createElement('audio'); a.hidden = true; document.body.append(a); return a; });
    this.online = options.online || (() => navigator.onLine !== false);
    this.generation = 0;
    this.player = this.rtc = this.audio = null;
    this.timer = this.retryTimer = this.monitor = this.rtcTimer = null;
    this.rtcCancel = null;
    this.volume = .75; this.speed = 1;
    this.room = null; this.inputURL = null;
    this.intent = 'stopped'; this.state = 'idle'; this.retryCount = 0; this.rtcUnavailable = false;
    this.onOnline = () => {
      if (this.intent === 'active' && this.state === 'reconnecting' && this.waitingOnline) {
        this.waitingOnline = false; this.scheduleRetry();
      }
    };
    this.onOffline = () => {
      if (this.intent === 'active' && this.state !== 'reconnecting') this.recover(this.error('网络已断开，联网后自动恢复。'));
    };
    window.addEventListener?.('online', this.onOnline);
    window.addEventListener?.('offline', this.onOffline);
  }
  error(message, retryable = true) { return Object.assign(new Error(message), { retryable }); }
  get isRTC() { return Boolean(this.rtc); }
  setVolume(value) { this.volume = value; if (this.audio) this.audio.volume = value; }
  setSpeed(value) { this.speed = value; if (this.audio) this.audio.playbackRate = value; }
  get bufferSeconds() {
    const a = this.audio;
    if (!a) return 0;
    // 断层之后的数据不能立即播放，只统计当前所在区间的连续缓冲。
    for (let i = 0; i < a.buffered.length; i++) {
      if (a.currentTime >= a.buffered.start(i) && a.currentTime <= a.buffered.end(i)) return a.buffered.end(i) - a.currentTime;
    }
    return 0;
  }
  emit(state, message = '') { this.state = state; this.onState(state, { room: this.room, message }); }
  detachAudio() {
    if (!this.audio) return;
    const audio = this.audio; this.audio = null;
    audio.onplaying = audio.onwaiting = audio.onerror = audio.onended = null;
    audio.pause(); audio.srcObject = null;
    audio.removeAttribute('src'); audio.load(); audio.remove();
  }
  release() {
    this.generation++;
    this.clock.clearTimeout(this.timer); this.timer = null;
    this.clock.clearTimeout(this.rtcTimer); this.rtcTimer = null;
    this.clock.clearInterval(this.monitor); this.monitor = null;
    const cancel = this.rtcCancel; this.rtcCancel = null; cancel?.();
    this.detachAudio();
    const player = this.player, rtc = this.rtc; this.player = this.rtc = null;
    try { player?.destroy(); } catch {}
    try { Promise.resolve(rtc?.unsubscribe()).catch(() => {}); } catch {}
    try { Promise.resolve(rtc?.dispose()).catch(() => {}); } catch {}
    try { Promise.resolve(this.bridge?.stopLive?.()).catch(() => {}); } catch {}
  }
  stop() {
    this.intent = 'stopped'; this.waitingOnline = false;
    this.clock.clearTimeout(this.retryTimer); this.retryTimer = null; this.release();
  }
  dispose() {
    this.stop();
    window.removeEventListener?.('online', this.onOnline); window.removeEventListener?.('offline', this.onOffline);
  }
  pause() { this.stop(); this.intent = 'paused'; this.emit('paused'); }
  async connect(url) {
    this.stop(); this.retryCount = 0; this.rtcUnavailable = false;
    this.inputURL = url; this.room = null; this.intent = 'active'; await this.attempt();
  }
  async attempt() {
    if (this.intent !== 'active') return;
    this.release();
    const generation = this.generation;
    const current = () => generation === this.generation && this.intent === 'active';
    const fail = error => { if (current()) this.recover(typeof error === 'string' ? this.error(error) : error); };
    this.emit(this.retryCount ? 'reconnecting' : 'connecting',
      this.retryCount ? `正在重新连接（${this.retryCount}/3）…` : '');
    try {
      if (!this.bridge?.resolveLive) throw this.error('请重新启动最新版 Mac 应用后收听；网页版仅支持界面体验。', false);
      if (!this.online()) throw this.error('网络已断开，联网后自动恢复。');
      const result = await this.bridge.resolveLive(this.inputURL);
      if (!current()) return;
      if (!result.ok) throw this.error(result.error, result.retryable === true);
      this.room = { title: result.title, liveId: result.liveId, platform: result.platform || 'taobao' };
      // 优先 ARTC 超低延时通道（WebRTC 直连，只收音轨）；本会话内失败过就不再尝试。
      if (result.rtcURL && window.AliRTS && !this.rtcUnavailable) {
        const started = await this.connectRTC(result, current, fail);
        if (!current() || started) return;
        this.rtcUnavailable = true;
      }
      await this.connectFLV(result, current, fail);
    } catch (error) {
      if (error.name === 'NotAllowedError') error = this.error('声音播放被阻止，请再点击一次快速播放。', false);
      fail(error);
    }
  }
  recover(error) {
    if (this.intent !== 'active') return;
    this.release(); this.clock.clearTimeout(this.retryTimer); this.retryTimer = null;
    if (error.retryable === false || this.retryCount >= 3) {
      this.intent = 'stopped'; this.emit('error', error.message || '连接失败，请重试。'); return;
    }
    if (!this.online()) {
      this.waitingOnline = true; this.emit('reconnecting', '网络已断开，联网后自动恢复。'); return;
    }
    this.scheduleRetry();
  }
  scheduleRetry() {
    if (this.intent !== 'active' || this.retryTimer !== null) return;
    if (this.retryCount >= 3) { this.intent = 'stopped'; this.emit('error', '自动重连未成功，请检查网络后重新播放。'); return; }
    const delay = [500, 1500, 3000][this.retryCount];
    this.emit('reconnecting', `连接中断，将自动重连（${this.retryCount + 1}/3）。`);
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      if (this.intent !== 'active') return;
      if (!this.online()) { this.waitingOnline = true; this.emit('reconnecting', '网络已断开，联网后自动恢复。'); return; }
      this.retryCount++; void this.attempt();
    }, delay);
  }
  armTimeout(current, fail, ms = 8000) {
    if (this.timer !== null) return;
    this.timer = this.clock.setTimeout(() => {
      this.timer = null; if (current()) fail(this.error('音频长时间没有继续播放，正在尝试恢复。'));
    }, ms);
  }
  attachAudio(current, fail) {
    const audio = this.audio = this.makeAudio();
    audio.preload = 'auto'; audio.volume = this.volume; audio.playbackRate = this.speed; audio.preservesPitch = true;
    audio.onplaying = () => {
      if (!current()) return;
      this.clock.clearTimeout(this.timer); this.timer = null;
      if (this.state !== 'playing') this.stableSince = this.clock.now();
      this.lastProgressAt = this.clock.now(); this.lastMediaTime = audio.currentTime; this.emit('playing');
    };
    audio.onwaiting = () => {
      if (!current()) return;
      if (audio.seeking && this.clock.now() - (this.lastSeekAt ?? -Infinity) < 600) return;
      this.stableSince = this.clock.now(); this.emit('buffering'); this.armTimeout(current, fail);
    };
    audio.onerror = () => { if (current()) fail(this.error('音频解码失败。', false)); };
    audio.onended = () => { if (current()) fail(this.error('音频流已结束，正在确认直播状态。')); };
    this.lastProgressAt = this.stableSince = this.clock.now(); this.lastMediaTime = 0;
    // 看门狗：媒体时间 10 秒不推进就重连；连续稳定播放 30 秒恢复重试额度。
    this.monitor = this.clock.setInterval(() => {
      if (!current() || this.audio !== audio) return;
      const now = this.clock.now();
      if (audio.currentTime > this.lastMediaTime + .001) this.lastProgressAt = now;
      if (now - this.lastProgressAt > 10000) { fail(this.error('音频停止推进，正在自动重连。')); return; }
      if (this.state === 'playing' && now - this.stableSince > 30000) this.retryCount = 0;
      this.lastMediaTime = audio.currentTime;
    }, 250);
    return audio;
  }

  async connectRTC(result, current, fail) {
    let client;
    try { client = this.rtc = window.AliRTS.createClient(); } catch { return false; }
    return new Promise(resolve => {
      let settled = false, started = false, abandoned = false;
      const valid = () => current() && !abandoned && this.rtc === client;
      const settle = value => { if (!settled) { settled = true; resolve(value); } };
      this.rtcCancel = () => settle(false);
      // ARTC 属于尽力而为：失败或 9 秒内没起播就静默退回 FLV，不弹错误、不重复点击。
      const fallback = () => {
        if (!valid()) return;
        abandoned = true;
        this.clock.clearTimeout(this.rtcTimer); this.rtcTimer = null;
        this.clock.clearTimeout(this.timer); this.timer = null;
        this.clock.clearInterval(this.monitor); this.monitor = null;
        this.rtc = null; this.detachAudio(); this.rtcCancel = null;
        try { Promise.resolve(client.unsubscribe()).catch(() => {}); } catch {}
        try { Promise.resolve(client.dispose()).catch(() => {}); } catch {}
        settle(false);
      };
      this.rtcTimer = this.clock.setTimeout(fallback, 9000);
      client.on('onError', () => { if (!valid()) return; if (!started) fallback(); else fail(this.error('低延时通道中断。')); });
      client.on('connectStatusChange', event => { if (valid() && event?.status === 'disconnected') { if (!started) fallback(); else fail(this.error('低延时连接已断开。')); } });
      Promise.resolve().then(() => client.subscribe(result.rtcURL)).then(stream => {
        if (!valid()) return;
        if (!stream.hasAudio) { fallback(); return; }
        stream.disableVideo();
        const audio = this.attachAudio(valid, error => started ? fail(error) : fallback());
        const onPlaying = audio.onplaying;
        audio.onplaying = () => {
          if (!valid()) return;
          started = true; this.clock.clearTimeout(this.rtcTimer); this.rtcTimer = null;
          this.rtcCancel = null; onPlaying(); settle(true);
        };
        this.emit('buffering'); return stream.play(audio, { autoplay: true });
      }).catch(fallback);
    });
  }

  async connectFLV(result, current, fail) {
    if (!window.mpegts?.getFeatureList?.().mseLivePlayback) throw this.error('当前环境不支持直播音频解码，请使用最新版 Mac 应用。', false);
    const audio = this.attachAudio(current, fail);
    const player = this.player = window.mpegts.createPlayer({ type: 'flv', isLive: true,
      url: result.streamURL, hasAudio: true, hasVideo: false }, {
      enableWorker: false, enableStashBuffer: false, lazyLoad: false,
      liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 1.2, liveBufferLatencyMinRemain: .3,
      autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 10,
      autoCleanupMinBackwardDuration: 3, statisticsInfoReportInterval: 1000
    });
    player.on(window.mpegts.Events.ERROR, (type, detail, info) => fail(this.error(
      `直播音频连接中断（${type} / ${detail}${info?.code ? ' / ' + info.code : ''}）。`,
      type === window.mpegts.ErrorTypes.NETWORK_ERROR)));
    player.on(window.mpegts.Events.MEDIA_INFO, info => {
      if (current() && !info.hasAudio) fail(this.error('这个直播流没有音轨，暂时无法收听。', false));
    });
    player.attachMediaElement(audio);
    player.load();
    if (!current()) return;
    this.emit('buffering');
    this.armTimeout(current, fail, 10000);
    await player.play();
  }
}

window.KuaitingLivePlayer = KuaitingLivePlayer;
