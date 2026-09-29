'use strict';

class KuaitingLivePlayer {
  constructor(onState) {
    this.onState = onState;
    this.generation = 0;
    this.player = null;
    this.rtc = null;
    this.audio = null;
    this.timer = null;
    this.volume = .75;
    this.speed = 1;
    this.room = null;
    this.inputURL = null;
  }

  get isRTC() { return Boolean(this.rtc); }
  setVolume(value) { this.volume = value; if (this.audio) this.audio.volume = value; }
  setSpeed(value) { this.speed = value; if (this.audio) this.audio.playbackRate = value; }
  get bufferSeconds() {
    if (!this.audio?.buffered.length) return 0;
    return Math.max(0, this.audio.buffered.end(this.audio.buffered.length - 1) - this.audio.currentTime);
  }

  stop() {
    this.generation++;
    clearTimeout(this.timer);
    if (this.audio) {
      this.audio.onplaying = this.audio.onwaiting = this.audio.onerror = this.audio.onended = null;
      this.audio.pause();
    }
    if (this.player) { try { this.player.destroy(); } catch {} }
    if (this.rtc) { try { this.rtc.unsubscribe(); } catch {} try { this.rtc.dispose(); } catch {} }
    if (this.audio) { this.audio.removeAttribute('src'); this.audio.load(); this.audio.remove(); }
    this.player = null; this.rtc = null; this.audio = null;
    window.kuaitingDesktop?.stopLive?.().catch(() => {});
  }

  pause() {
    this.stop();
    this.onState('paused', { room: this.room });
  }

  attachAudio(current, fail) {
    const audio = this.audio = document.createElement('audio');
    audio.hidden = true; audio.preload = 'auto'; audio.volume = this.volume;
    audio.playbackRate = this.speed; audio.preservesPitch = true;
    document.body.append(audio);
    const armTimeout = () => {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => fail('长时间没有收到可播放的音频，请点击快速播放重试。'), 20000);
    };
    audio.onplaying = () => {
      if (!current()) return;
      clearTimeout(this.timer);
      this.onState('playing', { room: this.room });
    };
    audio.onwaiting = () => {
      if (!current()) return;
      this.onState('buffering', { room: this.room }); armTimeout();
    };
    audio.onerror = () => fail('音频解码失败，请重新连接直播间。');
    return { audio, armTimeout };
  }

  async connect(url) {
    this.stop();
    const generation = this.generation;
    const current = () => generation === this.generation;
    this.inputURL = url;
    this.room = null;
    const fail = (message) => {
      if (!current()) return;
      this.stop();
      this.onState('error', { message });
    };
    this.onState('connecting', {});
    try {
      if (!window.kuaitingDesktop?.resolveLive) throw new Error('请重新启动最新版 Mac 应用后收听；网页版仅支持界面体验。');
      const result = await window.kuaitingDesktop.resolveLive(url);
      if (!current()) return;
      if (!result.ok) throw new Error(result.error);
      this.room = { title: result.title, liveId: result.liveId };
      // 优先 ARTC 超低延时通道（WebRTC 直连，只收音轨）；不可用时退回 FLV。
      if (result.rtcURL && window.AliRTS) return this.connectRTC(result, current, fail);
      return this.connectFLV(result, current, fail);
    } catch (error) {
      if (error.name === 'NotAllowedError' && current()) {
        fail('浏览器阻止了声音播放，请再次点击快速播放。');
      } else if (current()) fail(error.message || '直播连接失败，请重试。');
    }
  }

  async connectRTC(result, current, fail) {
    const client = this.rtc = AliRTS.createClient();
    let playing = false, abandoned = false;
    const cleanup = () => {
      if (this.rtc === client) {
        try { client.unsubscribe(); } catch {}
        try { client.dispose(); } catch {}
        this.rtc = null;
      }
      if (this.audio) { this.audio.remove(); this.audio = null; }
    };
    // ARTC 属于尽力而为：失败或 9 秒内没起播就静默退回 FLV，不弹错误、不重复点击。
    const fallback = () => {
      if (abandoned || !current()) return;
      abandoned = true;
      clearTimeout(giveUp);
      cleanup();
      return this.connectFLV(result, current, fail);
    };
    const giveUp = setTimeout(fallback, 9000);
    client.on('onError', () => { if (playing) fail('低延时通道中断，请重新连接。'); else fallback(); });
    client.on('connectStatusChange', event => {
      if (current() && event?.status === 'disconnected') this.onState('buffering', { room: this.room });
    });
    try {
      const stream = await client.subscribe(result.rtcURL);
      clearTimeout(giveUp);
      if (abandoned || !current()) return;
      if (!stream.hasAudio) { return fallback(); }
      stream.disableVideo();
      const { audio, armTimeout } = this.attachAudio(current, fail);
      const onPlaying = audio.onplaying;
      audio.onplaying = () => { playing = true; onPlaying?.(); };
      audio.onended = () => fail('低延时连接已断开，主播可能已下播。');
      this.onState('buffering', { room: this.room });
      armTimeout();
      stream.play(audio, { autoplay: true });
    } catch {
      return fallback();
    }
  }

  async connectFLV(result, current, fail) {
    if (!window.mpegts?.getFeatureList().mseLivePlayback) throw new Error('当前环境不支持直播音频解码，请使用最新版 Mac 应用。');
    const { audio, armTimeout } = this.attachAudio(current, fail);
    audio.onended = () => fail('音频流已结束，主播可能已下播。');
    const player = this.player = mpegts.createPlayer({ type: 'flv', isLive: true,
      url: result.streamURL, hasAudio: true, hasVideo: false }, {
      enableWorker: false, enableStashBuffer: false, lazyLoad: false,
      liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 1.2, liveBufferLatencyMinRemain: .3,
      autoCleanupSourceBuffer: true, autoCleanupMaxBackwardDuration: 10,
      autoCleanupMinBackwardDuration: 3, statisticsInfoReportInterval: 1000
    });
    player.on(mpegts.Events.ERROR, (type, detail, info) => fail(`直播音频连接中断（${type} / ${detail}${info?.code ? ' / ' + info.code : ''}），请重新连接。`));
    player.on(mpegts.Events.MEDIA_INFO, info => {
      if (current() && !info.hasAudio) fail('这个直播流没有音轨，暂时无法收听。');
    });
    player.attachMediaElement(audio);
    player.load();
    this.onState('buffering', { room: this.room });
    armTimeout();
    await player.play();
  }
}

window.KuaitingLivePlayer = KuaitingLivePlayer;
