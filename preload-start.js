const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');

const INTERNAL_HTML_DIR = path.resolve(__dirname, 'html');

function isTrustedOrigin() {
  try {
    if (window.location.protocol !== 'file:') return false;
    const filePath = fileURLToPath(window.location.href);
    const resolvedPath = path.resolve(filePath);
    return resolvedPath.startsWith(INTERNAL_HTML_DIR + path.sep);
  } catch (err) {
    return false;
  }
}

function invokeIfTrusted(channel, ...args) {
  if (!isTrustedOrigin()) return Promise.resolve(null);
  return ipcRenderer.invoke(channel, ...args);
}

function sendIfTrusted(channel, ...args) {
  if (!isTrustedOrigin()) return;
  ipcRenderer.send(channel, ...args);
}

function onIfTrusted(channel, callback) {
  if (!isTrustedOrigin()) return;
  ipcRenderer.on(channel, (event, ...args) => callback(...args));
}

contextBridge.exposeInMainWorld('vitamin', {
  getAppVersion: () => invokeIfTrusted('get-app-version'),
  getSettings: () => invokeIfTrusted('get-settings'),
  getPoisonState: () => invokeIfTrusted('get-poison-state'),
  onThemeChange: (callback) => onIfTrusted('theme-change', callback),
  onPoisonState: (callback) => onIfTrusted('poison-state', callback),
  onPerformanceModeChange: (callback) => onIfTrusted('performance-mode-change', callback),
  searchRequest: (query) => sendIfTrusted('search-request', query),
  proceedPalantirUrl: (url) => sendIfTrusted('proceed-palantir-url', url),
  proceedBlockedUrl: (url) => sendIfTrusted('proceed-blocked-url', url)
});
