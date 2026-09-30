'use strict';

const { app, BrowserWindow, Menu, ipcMain, clipboard, session, protocol } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { resolveRoom: resolveTaobao, openStream } = require('./taobao-live.cjs');
const { resolveRoom: resolveXHS } = require('./xhs-live.cjs');
const { resolveRoom: resolveDouyin } = require('./dy-live.cjs');
const { parse: parseRoomLink } = require('../dist/room-link.js');

protocol.registerSchemesAsPrivileged([{ scheme: 'kuaiting-stream', privileges: {
  standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true
} }]);

const smokeTest = process.argv.includes('--smoke-test');
const development = process.argv.includes('--dev');
const pagePath = path.join(__dirname, '..', 'dist', 'index.html');
const pageURL = pathToFileURL(pagePath).href;
let mainWindow;
let reloadTimer;
let watcher;
let smokeTimer;
let smokeDirectory;
let activeLive = null;
let resolveController;
let resolveGeneration = 0;

function stopLive() {
  resolveGeneration++;
  resolveController?.abort();
  resolveController = null;
  if (activeLive) for (const controller of activeLive.controllers) controller.abort();
  activeLive = null;
}

app.setName('快听');
if (smokeTest) {
  smokeDirectory = process.env.KUAITING_SMOKE_USER_DATA || fs.mkdtempSync(path.join(os.tmpdir(), 'kuaiting-smoke-'));
  app.setPath('userData', smokeDirectory);
}

function trustedSender(event) {
  return Boolean(mainWindow && event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame &&
    event.senderFrame.url === pageURL);
}

ipcMain.handle('kuaiting:read-clipboard', (event) => {
  if (!trustedSender(event)) throw new Error('不允许此页面读取剪贴板');
  return clipboard.readText();
});

ipcMain.handle('kuaiting:resolve-live', async (event, value) => {
  if (!trustedSender(event)) return { ok: false, error: '此页面不能连接直播。' };
  stopLive();
  const generation = resolveGeneration;
  resolveController = new AbortController();
  try {
    const link = parseRoomLink(value);
    const live = link.platform === 'xhs' ? await resolveXHS(value, { signal: resolveController.signal }) :
      link.platform === 'douyin' ? await resolveDouyin(value, { signal: resolveController.signal }) :
      await resolveTaobao(value, { signal: resolveController.signal });
    if (generation !== resolveGeneration) return { ok: false, error: '连接已取消。' };
    const id = randomUUID();
    activeLive = { ...live, id, controllers: new Set() };
    // 淘宝内部 ARTC 信令与公开 SDK 不兼容（实测 404，2026-09-28），默认关闭以免拖慢起播；
    // 渲染端保留完整退回逻辑，未来可用 KUAITING_ARTC=1 启用验证。
    const rtcURL = process.env.KUAITING_ARTC === '1' ? (live.rtcURL || null) : null;
    return { ok: true, liveId: live.liveId, title: live.title, platform: link.platform, rtcURL, streamURL: `kuaiting-stream://live/${id}` };
  } catch (error) {
    const platform = (() => { try { return parseRoomLink(value).platform; } catch { return 'taobao'; } })();
    const target = platform === 'xhs' ? '小红书' : platform === 'douyin' ? '抖音' : '淘宝';
    const message = error.name === 'TimeoutError' ? `连接${target}超时，请检查网络后重试。` :
      error.name === 'AbortError' ? '连接已取消。' : error.message === 'fetch failed' ? `暂时无法连接${target}，请检查网络后重试。` : error.message;
    const retryable = error.retryable ?? ['TimeoutError', 'TypeError'].includes(error.name);
    return { ok: false, error: message || '直播连接失败，请重试。', retryable };
  }
});
ipcMain.handle('kuaiting:stop-live', (event) => {
  if (trustedSender(event)) stopLive();
});

function installLiveProtocol() {
  protocol.handle('kuaiting-stream', async request => {
    const url = new URL(request.url);
    const live = activeLive;
    if (!live || url.hostname !== 'live' || url.pathname !== `/${live.id}` || request.method !== 'GET') {
      return new Response('Stream unavailable', { status: 404 });
    }
    const controller = new AbortController();
    live.controllers.add(controller);
    request.signal.addEventListener('abort', () => controller.abort(), { once: true });
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const upstream = await openStream(live.sourceURL, { signal: controller.signal });
      clearTimeout(timer);
      if (!upstream.ok || !upstream.body) { controller.abort(); return new Response('Upstream unavailable', { status: 502 }); }
      return new Response(upstream.body, { headers: {
        'Content-Type': 'video/x-flv', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store'
      } });
    } catch {
      clearTimeout(timer);
      live.controllers.delete(controller);
      return new Response('Stream connection failed', { status: 502 });
    }
  });
}

function installMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: '快听', submenu: [
      { role: 'about', label: '关于快听' }, { type: 'separator' },
      { role: 'hide', label: '隐藏快听' }, { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '显示全部' }, { type: 'separator' },
      { role: 'quit', label: '退出快听' }
    ] },
    { label: '编辑', submenu: [
      { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' },
      { type: 'separator' }, { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ] },
    { label: '显示', submenu: [
      { role: 'reload', label: '重新加载' },
      ...(!app.isPackaged ? [{ role: 'toggleDevTools', label: '开发者工具' }] : []),
      { type: 'separator' }, { role: 'resetZoom', label: '实际大小' },
      { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
      { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }
    ] },
    { label: '窗口', submenu: [
      { role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' },
      { role: 'front', label: '前置全部窗口' }, { role: 'close', label: '关闭窗口' }
    ] }
  ]));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: '快听 · 让声音先一步', width: 1460, height: 1000,
    minWidth: 860, minHeight: 680, backgroundColor: '#f5f9f7',
    show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, backgroundThrottling: false
    }
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pageURL) event.preventDefault();
  });
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.once('ready-to-show', () => { if (!smokeTest) mainWindow.show(); });
  mainWindow.on('closed', () => { stopLive(); mainWindow = null; });
  mainWindow.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) stopLive(); });
  if (smokeTest) {
    const fail = (message) => { console.error(message); app.exit(1); };
    mainWindow.webContents.on('did-fail-load', (_event, code, description) => fail(`Load failed (${code}): ${description}`));
    mainWindow.webContents.on('render-process-gone', (_event, details) => fail(`Renderer exited: ${details.reason}`));
    mainWindow.webContents.on('preload-error', (_event, _path, error) => fail(`Preload failed: ${error.message}`));
    mainWindow.webContents.on('console-message', (_event, details) => {
      if (details.level === 'error') fail(`Renderer error: ${details.message}`);
    });
    ipcMain.once('kuaiting:renderer-ready', event => {
      if (!trustedSender(event)) return fail('Unexpected renderer origin');
      clearTimeout(smokeTimer);
      console.log('PASS: desktop window loaded local assets; isolated preload and renderer initialized.');
      setTimeout(() => app.quit(), 300);
    });
    smokeTimer = setTimeout(() => fail('Desktop initialization timed out'), 20000);
  }
  mainWindow.loadFile(pagePath).catch(error => { console.error(error); if (smokeTest) app.exit(1); });
}

if (!smokeTest && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return createWindow();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show(); mainWindow.focus();
  });
  app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    app.setAboutPanelOptions({ applicationName: '快听', applicationVersion: app.getVersion(),
      copyright: '电脑听声音，手机轻松互动。',
      iconPath: path.join(__dirname, '..', 'assets', 'icon.png') });
    if (process.platform === 'darwin') app.dock.setIcon(path.join(__dirname, '..', 'assets', 'icon.png'));
    installLiveProtocol(); installMenu(); createWindow();
    if (development && !app.isPackaged) {
      watcher = fs.watch(path.join(__dirname, '..', 'dist'), { recursive: true }, () => {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload(); }, 150);
      });
    }
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(error => { console.error(error); app.exit(1); });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin' || smokeTest) app.quit(); });
app.on('will-quit', () => { stopLive(); watcher?.close(); clearTimeout(reloadTimer); clearTimeout(smokeTimer); });
