const { app, session, ipcMain } = require('electron');
const { ElectronBlocker } = require('@ghostery/adblocker-electron');
const fs = require('fs');
const path = require('path');

const blockerCachePath = path.join(app.getPath('userData'), 'adblocker-cache.bin');

let blocker = null;
let blockedCount = 0;
let adBlockerInitInProgress = false;
let blockerListenerAttached = false;
let adBlockingEnabled = false;

// Callbacks set by main.js
let getSettings = null;
let getMainWindow = null;

function configure(options) {
  getSettings = options.getSettings;
  getMainWindow = options.getMainWindow;
}

async function init() {
  if (adBlockerInitInProgress) {
    console.log('Ad blocker initialization already in progress, skipping');
    return;
  }

  if (blocker) {
    console.log('Ad blocker already initialized, skipping');
    return;
  }

  adBlockerInitInProgress = true;

  try {
    console.log('Initializing ad blocker...');

    const maxRetries = 3;
    const retryDelay = 1000;

    // Try to load from cache first (faster startup)
    try {
      if (fs.existsSync(blockerCachePath)) {
        const cachedData = fs.readFileSync(blockerCachePath);
        blocker = ElectronBlocker.deserialize(cachedData);
        console.log('Ad blocker loaded from cache');

        const settings = getSettings();
        if (settings.adBlockEnabled) {
          enable();
        }

        // Update cache in background (don't block startup)
        updateCache();
        return;
      }
    } catch (err) {
      console.log('Cache load failed, will download fresh:', err.message);
    }

    // No cache or cache failed - download with retries
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Ad blocker download attempt ${attempt}/${maxRetries}...`);
        blocker = await ElectronBlocker.fromPrebuiltAdsOnly(fetch);
        console.log('Ad blocker initialized from network (ads-only lists)');

        // Save to cache for next time
        try {
          const serialized = blocker.serialize();
          fs.writeFileSync(blockerCachePath, Buffer.from(serialized));
          console.log('Ad blocker cached for faster startup');
        } catch (cacheErr) {
          console.error('Failed to cache ad blocker:', cacheErr.message);
        }

        const settings = getSettings();
        if (settings.adBlockEnabled) {
          enable();
        }
        return;
      } catch (err) {
        console.error(`Ad blocker attempt ${attempt} failed:`, err.message);
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay * attempt));
        }
      }
    }

    console.error('Ad blocker initialization failed after all retries');
  } finally {
    adBlockerInitInProgress = false;
  }
}

async function updateCache() {
  if (blocker) {
    console.log('Skipping cache update - ad blocker already initialized');
    return;
  }

  try {
    const freshBlocker = await ElectronBlocker.fromPrebuiltAdsOnly(fetch);
    const serialized = freshBlocker.serialize();
    fs.writeFileSync(blockerCachePath, Buffer.from(serialized));
    console.log('Ad blocker cache updated in background (ads-only lists)');
  } catch (err) {
    // Silent fail - we already have a working cached version
  }
}

function enable() {
  if (!blocker) return;

  if (adBlockingEnabled) {
    console.log('Ad blocking already enabled, skipping');
    return;
  }

  const ses = session.defaultSession;
  blocker.enableBlockingInSession(ses);

  // Add custom exception rules to prevent website breakage
  try {
    blocker.exceptions.updateFromDiff({
      added: [
        '||do-not-tracker.org/favicon.ico',
        '||*favicon.ico'
      ]
    });
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
  if (!blocker) return;

  const ses = session.defaultSession;
  blocker.disableBlockingInSession(ses);
  adBlockingEnabled = false;
  console.log('Ad blocking disabled');
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

module.exports = {
  configure,
  init,
  enable,
  disable,
  isEnabled,
  getBlockedCount,
  registerIPC
};
