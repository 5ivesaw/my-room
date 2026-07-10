const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');

let dashboard = null;
let chatWindow = null;
let tray = null;
let settings = { chatUrl: '', startAtLogin: true };
let currentStatus = 'offline';

function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { settings = { ...settings, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch {}
}
function saveSettings() {
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), { mode: 0o600 });
}
function applyStartup(enabled) {
  settings.startAtLogin = Boolean(enabled);
  const args = app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'];
  app.setLoginItemSettings({ openAtLogin: settings.startAtLogin, openAsHidden: true, path: process.execPath, args });
  saveSettings();
}
function trustedChatOrigin() {
  try { return settings.chatUrl ? new URL(settings.chatUrl).origin : ''; } catch { return ''; }
}
function createDashboard() {
  dashboard = new BrowserWindow({
    width: 460, height: 660, minWidth: 380, minHeight: 540, show: false,
    title: 'Kingdom Companion', backgroundColor: '#080509',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  dashboard.removeMenu();
  dashboard.loadFile('index.html');
  dashboard.on('close', (event) => { if (!app.isQuitting) { event.preventDefault(); dashboard.hide(); } });
  dashboard.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}
function openChat(show = true) {
  if (!settings.chatUrl) { dashboard.show(); dashboard.webContents.send('needs-chat-url'); return; }
  if (!chatWindow || chatWindow.isDestroyed()) {
    chatWindow = new BrowserWindow({
      width: 1080, height: 760, minWidth: 360, minHeight: 540, show: false,
      title: 'Audience Messages', backgroundColor: '#070a12',
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, partition: 'persist:kingdom-chat' }
    });
    chatWindow.removeMenu();
    chatWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      const origin = (() => { try { return new URL(webContents.getURL()).origin; } catch { return ''; } })();
      const allowed = permission === 'media' || (permission === 'notifications' && currentStatus === 'online');
      callback(origin === trustedChatOrigin() && allowed);
    });
    chatWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
      const origin = (() => { try { return new URL(webContents.getURL()).origin; } catch { return ''; } })();
      return origin === trustedChatOrigin() && (permission === 'media' || (permission === 'notifications' && currentStatus === 'online'));
    });
    chatWindow.loadURL(settings.chatUrl);
    chatWindow.on('close', (event) => { if (!app.isQuitting) { event.preventDefault(); chatWindow.hide(); } });
    chatWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith(trustedChatOrigin())) return { action: 'allow' };
      if (/^https:\/\//i.test(url)) shell.openExternal(url);
      return { action: 'deny' };
    });
  }
  if (show) { chatWindow.show(); chatWindow.focus(); }
}
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'my-room-icon.svg'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('Kingdom Companion');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Presence & status', click: () => { dashboard.show(); dashboard.focus(); } },
    { label: 'Audience messages', click: () => openChat(true) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { dashboard.show(); dashboard.focus(); });
}

app.whenReady().then(() => {
  loadSettings();
  applyStartup(settings.startAtLogin);
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const origin = (() => { try { return new URL(webContents.getURL()).origin; } catch { return ''; } })();
    callback(origin === trustedChatOrigin() && ['notifications', 'media'].includes(permission));
  });
  createDashboard();
  createTray();
  openChat(false);
  if (!process.argv.includes('--hidden')) dashboard.show();
});

app.on('window-all-closed', (event) => event.preventDefault());
app.on('before-quit', () => { app.isQuitting = true; });

ipcMain.handle('get-settings', () => ({ ...settings, startup: app.getLoginItemSettings().openAtLogin }));
ipcMain.handle('set-startup', (_event, enabled) => { applyStartup(enabled); return settings.startAtLogin; });
ipcMain.handle('set-chat-url', (_event, value) => {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:') throw new Error('The chat URL must use HTTPS.');
  settings.chatUrl = url.toString();
  saveSettings();
  if (chatWindow && !chatWindow.isDestroyed()) chatWindow.destroy();
  openChat(false);
  return settings.chatUrl;
});
ipcMain.handle('open-chat', () => openChat(true));
ipcMain.handle('set-status-mode', (_event, status) => {
  currentStatus = ['online', 'busy', 'sleeping', 'offline'].includes(status) ? status : 'offline';
  return currentStatus;
});
