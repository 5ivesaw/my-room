const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kingdomDesktop', Object.freeze({
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setStartup: (enabled) => ipcRenderer.invoke('set-startup', Boolean(enabled)),
  setChatUrl: (url) => ipcRenderer.invoke('set-chat-url', String(url || '')),
  openChat: () => ipcRenderer.invoke('open-chat'),
  setStatusMode: (status) => ipcRenderer.invoke('set-status-mode', String(status || 'offline')),
  notifyAudience: (preview) => ipcRenderer.invoke('notify-audience', String(preview || '')),
  onPrepareOffline: (callback) => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('prepare-offline', () => callback());
  },
  offlineReady: () => ipcRenderer.send('offline-ready')
}));
