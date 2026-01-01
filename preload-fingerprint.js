const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const INTERNAL_HTML_DIR = path.resolve(__dirname, 'html');
const FINGERPRINT_SCRIPT_PATH = path.join(__dirname, 'fingerprint-protection.js');
let fingerprintScript = '';

try {
  fingerprintScript = fs.readFileSync(FINGERPRINT_SCRIPT_PATH, 'utf8');
} catch (err) {
  console.error('Failed to load fingerprint protection script:', err.message);
}

function isInternalFile() {
  try {
    if (window.location.protocol !== 'file:') return false;
    const filePath = fileURLToPath(window.location.href);
    const resolvedPath = path.resolve(filePath);
    return resolvedPath.startsWith(INTERNAL_HTML_DIR + path.sep);
  } catch (err) {
    return false;
  }
}

function injectScriptIntoPage(scriptContent) {
  if (!scriptContent) return;
  try {
    const container = document.documentElement || document.head;
    if (!container) {
      document.addEventListener('readystatechange', () => {
        const fallbackContainer = document.documentElement || document.head;
        if (!fallbackContainer) return;
        const script = document.createElement('script');
        script.textContent = scriptContent;
        fallbackContainer.appendChild(script);
        script.remove();
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.textContent = scriptContent;
    container.appendChild(script);
    script.remove();
  } catch (err) {
    console.error('Failed to inject script into page:', err.message);
  }
}

function getPrivacySettingsSync() {
  try {
    return ipcRenderer.sendSync('get-privacy-settings-sync');
  } catch (err) {
    return { blockFingerprinting: true, blockFingerprintTests: false };
  }
}

function isFingerprintTestHost() {
  const host = (window.location && window.location.hostname) || '';
  return host === 'coveryourtracks.eff.org'
    || host === 'firstpartysimulator.net'
    || host === 'firstpartysimulator.org';
}

function injectFingerprintTestBlocker() {
  const blockerScript = `
    (function() {
      if (window.__vitaminFingerprintTestBlocked) return;
      window.__vitaminFingerprintTestBlocked = true;
      try {
        const originalGetContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          if (type === '2d' || type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
            return null;
          }
          return originalGetContext.call(this, type, ...args);
        };
      } catch (e) {}
      try {
        window.AudioContext = undefined;
        window.webkitAudioContext = undefined;
        window.OfflineAudioContext = undefined;
        window.webkitOfflineAudioContext = undefined;
      } catch (e) {}
    })();
  `;

  injectScriptIntoPage(blockerScript);
}

const privacySettings = getPrivacySettingsSync();
const fingerprintingEnabled = privacySettings.blockFingerprinting !== false;
const fingerprintTestsBlocked = privacySettings.blockFingerprintTests === true;

if (!isInternalFile() && fingerprintTestsBlocked && isFingerprintTestHost()) {
  injectFingerprintTestBlocker();
}

if (!isInternalFile() && fingerprintingEnabled) {
  injectScriptIntoPage(fingerprintScript);
}
