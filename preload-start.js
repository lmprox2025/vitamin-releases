const { contextBridge, ipcRenderer, webFrame } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const INTERNAL_HTML_DIR = path.resolve(__dirname, 'html');
const FINGERPRINT_SCRIPT_PATH = path.join(__dirname, 'fingerprint-protection.js');
let fingerprintScript = '';

try {
  fingerprintScript = fs.readFileSync(FINGERPRINT_SCRIPT_PATH, 'utf8');
} catch (err) {
  console.error('Failed to load fingerprint protection script in preload:', err.message);
}

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

function injectFingerprintProtection() {
  if (isTrustedOrigin()) return;
  if (!fingerprintScript) return;
  let enabled = true;
  try {
    enabled = ipcRenderer.sendSync('get-fingerprint-setting-sync') === true;
  } catch (err) {
    console.error('Failed to fetch fingerprinting setting in preload:', err.message);
  }

  if (!enabled) return;

  try {
    webFrame.executeJavaScript(fingerprintScript, true);
  } catch (err) {
    console.error('Failed to inject fingerprint protection in preload:', err.message);
  }
}

injectFingerprintProtection();

if (isTrustedOrigin()) {
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
}
