const { app, ipcMain, session } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fetch = require('cross-fetch');
const fs = require('fs');
const path = require('path');

let blocker = null;
let blockedCount = 0;
let adBlockerInitInProgress = false;
let blockerListenerAttached = false;
let adBlockingEnabled = false;
let cacheUpdateInProgress = false;
let initPromise = null;
let builtInFiltersApplied = false;
let currentAggressiveMode = null;
let cosmeticPreloadId = null;
let cosmeticHandlersReady = false;

const AGGRESSIVE_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://easylist.to/easylist/fanboy-annoyance.txt',
  'https://easylist.to/easylist/fanboy-social.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt',
  'https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/annoyances.txt'
];

// Callbacks set by main.js
let getSettings = null;
let getMainWindow = null;

function configure(options) {
  getSettings = options.getSettings;
  getMainWindow = options.getMainWindow;
}

function getAggressiveSetting() {
  try {
    const settings = getSettings ? getSettings() : null;
    return settings ? settings.aggressiveAdBlock === true : false;
  } catch (err) {
    return false;
  }
}

function getCachePath() {
  const suffix = getAggressiveSetting() ? 'v3-aggressive' : 'v3';
  return path.join(app.getPath('userData'), `adblocker-cache-${suffix}.bin`);
}

async function createBlocker(aggressive) {
  try {
    if (aggressive) {
      return await ElectronBlocker.fromLists(fetch, AGGRESSIVE_LISTS);
    }
    return await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch);
  } catch (err) {
    console.warn('Ads+tracking lists unavailable, falling back to ads-only:', err.message);
    return ElectronBlocker.fromPrebuiltAdsOnly(fetch);
  }
}

function applyBuiltInFilters() {
  if (!blocker || builtInFiltersApplied) return;
  try {
    const builtInFilters = [
      '||doubleclick.net^',
      '||stats.g.doubleclick.net^',
      '||googlesyndication.com^',
      '||adservice.google.com^',
      '||googletagmanager.com^',
      '||google-analytics.com^',
      '||connect.facebook.net^',
      '||facebook.com/tr^',
      '||analytics.twitter.com^',
      '||bat.bing.com^',
      '||stats.wp.com^',
      '||segment.io^',
      '||mixpanel.com^',
      '||hotjar.com^'
    ];
    blocker.updateFromDiff({ added: builtInFilters });
    builtInFiltersApplied = true;
  } catch (err) {
    console.warn('Failed to apply built-in tracking filters:', err.message);
  }
}

function ensureCosmeticSupport() {
  if (!session || !session.defaultSession) return;
  const ses = session.defaultSession;

  if (!cosmeticPreloadId && typeof ses.registerPreloadScript === 'function') {
    try {
      const preloadPath = require.resolve('@ghostery/adblocker-electron-preload');
      cosmeticPreloadId = ses.registerPreloadScript({
        type: 'frame',
        filePath: preloadPath
      });
    } catch (err) {
      console.warn('Failed to register cosmetic preload script:', err.message);
    }
  }

  if (!cosmeticHandlersReady) {
    ipcMain.handle('@ghostery/adblocker/inject-cosmetic-filters', async (event, url, data) => {
      if (!blocker || !adBlockingEnabled) {
        return { active: false, styles: '', scripts: [], extended: [] };
      }
      return blocker.onInjectCosmeticFilters(event, url, data);
    });

    ipcMain.handle('@ghostery/adblocker/is-mutation-observer-enabled', async (event) => {
      if (!blocker || !adBlockingEnabled) return false;
      return blocker.onIsMutationObserverEnabled(event);
    });

    cosmeticHandlersReady = true;
  }
}

async function init() {
  const aggressive = getAggressiveSetting();
  if (blocker && currentAggressiveMode === aggressive) {
    console.log('Ad blocker already initialized, skipping');
    return true;
  }

  if (blocker && currentAggressiveMode !== aggressive) {
    blocker = null;
    adBlockingEnabled = false;
    builtInFiltersApplied = false;
  }

  if (initPromise) {
    console.log('Ad blocker initialization already in progress, awaiting');
    return initPromise;
  }

  currentAggressiveMode = aggressive;
  adBlockerInitInProgress = true;

  initPromise = (async () => {
    console.log('Initializing ad blocker...');

    const maxRetries = 3;
    const retryDelay = 1000;
    const cachePath = getCachePath();

    // Try to load from cache first (faster startup)
    try {
      if (fs.existsSync(cachePath)) {
        const cachedData = fs.readFileSync(cachePath);
        blocker = ElectronBlocker.deserialize(cachedData);
        console.log('Ad blocker loaded from cache');
        applyBuiltInFilters();

        const settings = getSettings();
        if (settings.adBlockEnabled) {
          enable();
        }

        // Update cache in background (don't block startup)
        updateCache();
        return true;
      }
    } catch (err) {
      console.log('Cache load failed, will download fresh:', err.message);
    }

    // No cache or cache failed - download with retries
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Ad blocker download attempt ${attempt}/${maxRetries}...`);
        blocker = await createBlocker(aggressive);
        console.log('Ad blocker initialized from network (filter lists)');
        applyBuiltInFilters();

        // Save to cache for next time
        try {
          const serialized = blocker.serialize();
          fs.writeFileSync(cachePath, Buffer.from(serialized));
          console.log('Ad blocker cached for faster startup');
        } catch (cacheErr) {
          console.error('Failed to cache ad blocker:', cacheErr.message);
        }

        const settings = getSettings();
        if (settings.adBlockEnabled) {
          enable();
        }
        return true;
      } catch (err) {
        console.error(`Ad blocker attempt ${attempt} failed:`, err.message);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
      }
    }

    console.error('Ad blocker initialization failed after all retries');
    return false;
  })();

  try {
    return await initPromise;
  } finally {
    adBlockerInitInProgress = false;
    initPromise = null;
  }
}

async function waitUntilReady(timeoutMs = 2500) {
  if (blocker) return true;
  const initResult = init().catch(() => false);
  if (!timeoutMs || timeoutMs <= 0) return initResult;
  return Promise.race([
    initResult,
    new Promise(resolve => setTimeout(() => resolve(!!blocker), timeoutMs))
  ]);
}

async function updateCache() {
  if (cacheUpdateInProgress) {
    console.log('Skipping cache update - already in progress');
    return;
  }

  cacheUpdateInProgress = true;
  try {
    const freshBlocker = await createBlocker(getAggressiveSetting());
    const serialized = freshBlocker.serialize();
    fs.writeFileSync(getCachePath(), Buffer.from(serialized));
    console.log('Ad blocker cache updated in background (filter lists)');
  } catch (err) {
    // Silent fail - we already have a working cached version
  } finally {
    cacheUpdateInProgress = false;
  }
}

function enable() {
  if (!blocker) return;

  if (adBlockingEnabled) {
    console.log('Ad blocking already enabled, skipping');
    return;
  }
  applyBuiltInFilters();
  ensureCosmeticSupport();

  // Optional exception rules to prevent breakage (if supported)
  try {
    if (typeof blocker.updateFromDiff === 'function') {
      blocker.updateFromDiff({
        added: [
          '@@||do-not-tracker.org/favicon.ico',
          '@@||*favicon.ico'
        ]
      });
    }
  } catch (err) {
    console.log('Failed to update blocker exceptions, continuing without them:', err.message);
  }

  // Track blocked requests (only attach listener once)
  if (!blockerListenerAttached) {
    blocker.on('request-blocked', (request) => {
      blockedCount++;
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('blocked-count', blockedCount);
      }
    });
    blockerListenerAttached = true;
  }

  adBlockingEnabled = true;
  console.log('Ad blocking enabled');
}

function disable() {
  adBlockingEnabled = false;
  console.log('Ad blocking disabled');
}

function handleBeforeRequest(details, callback) {
  if (!blocker || !adBlockingEnabled) return false;
  try {
    blocker.onBeforeRequest(details, callback);
    return true;
  } catch (err) {
    console.warn('Ad blocker before-request handler failed:', err.message);
    return false;
  }
}

function handleHeadersReceived(details, callback) {
  if (!blocker || !adBlockingEnabled) return false;
  try {
    blocker.onHeadersReceived(details, callback);
    return true;
  } catch (err) {
    console.warn('Ad blocker headers handler failed:', err.message);
    return false;
  }
}

function isEnabled() {
  return adBlockingEnabled;
}

function getBlockedCount() {
  return blockedCount;
}

function registerIPC(saveSettings) {
  ipcMain.on('toggle-adblock', (event, enabled) => {
    const settings = getSettings();
    settings.adBlockEnabled = enabled;
    saveSettings();

    if (enabled) {
      enable();
    } else {
      disable();
    }
  });
}

async function reinitialize() {
  blocker = null;
  adBlockingEnabled = false;
  builtInFiltersApplied = false;
  currentAggressiveMode = null;
  return init().then((ok) => {
    const settings = getSettings ? getSettings() : null;
    if (ok && settings && settings.adBlockEnabled) {
      enable();
    }
    return ok;
  });
}

module.exports = {
  configure,
  init,
  waitUntilReady,
  reinitialize,
  enable,
  disable,
  handleBeforeRequest,
  handleHeadersReceived,
  isEnabled,
  getBlockedCount,
  registerIPC
};
