'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kuaitingDesktop', Object.freeze({
  platform: process.platform,
  readClipboard: () => ipcRenderer.invoke('kuaiting:read-clipboard'),
  resolveLive: (url) => ipcRenderer.invoke('kuaiting:resolve-live', url),
  stopLive: () => ipcRenderer.invoke('kuaiting:stop-live'),
  ready: () => ipcRenderer.send('kuaiting:renderer-ready')
}));
