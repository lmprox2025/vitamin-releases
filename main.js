const { app, BrowserWindow, BrowserView, ipcMain, nativeImage, session, globalShortcut, Menu, net, shell, nativeTheme } = require('electron');
const path = require('path');
const { fileURLToPath } = require('url');
const fs = require('fs');
const { frequencies, getSearchTerms, getSites, getDelay, getPersonaList, getFrequencyList } = require('./poisonData');
const fetch = require('cross-fetch');
const os = require('os');
const historyModule = require('./history');
const bookmarksModule = require('./bookmarks');
const adblockModule = require('./adblock');

// Load fingerprint protection script
let fingerprintProtectionScript = '';
try {
  fingerprintProtectionScript = fs.readFileSync(path.join(__dirname, 'fingerprint-protection.js'), 'utf8');
  console.log('Fingerprint protection script loaded successfully');
} catch (e) {
  console.error('Failed to load fingerprint protection script:', e.message);
}

let fingerprintPreloadId = null;

function registerFingerprintPreloadScript() {
  if (fingerprintPreloadId) return;
  const ses = session.defaultSession;
  if (!ses || typeof ses.registerPreloadScript !== 'function') return;
  const preloadPath = path.join(__dirname, 'preload-fingerprint.js');
  try {
    fingerprintPreloadId = ses.registerPreloadScript({
      type: 'frame',
      filePath: preloadPath
    });
  } catch (err) {
    console.error('Failed to register fingerprint preload script:', err.message);
  }
}

// Linux GPU and display compatibility
// These must be set before app is ready
if (process.platform === 'linux') {
  // Disable GPU compositing to prevent blank windows on some drivers
  app.commandLine.appendSwitch('disable-gpu-compositing');
  // Enable Ozone platform for better Wayland/X11 compatibility
  app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
  // Disable GPU sandbox which can fail on some distros
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  // Use software rendering as fallback if GPU fails
  app.commandLine.appendSwitch('disable-software-rasterizer');
} else {
  // Disable GPU acceleration on all platforms to reduce GPU errors
  app.commandLine.appendSwitch('disable-gpu');
  // Disable additional GPU flags that cause conflicts
  app.commandLine.appendSwitch('disable-gpu-compositing');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-software-rasterizer');
}

// Reduce exposed client hints
app.commandLine.appendSwitch('disable-features', 'UserAgentClientHint');
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('disable-3d-apis');

// Check if running in a restricted environment (unprivileged userns disabled)
// Some distros like Debian/Ubuntu with hardened kernels need --no-sandbox
try {
  const { execSync } = require('child_process');
  const result = execSync('cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1', { encoding: 'utf8' });
  if (result.trim() === '0') {
    // Unprivileged user namespaces disabled - sandbox might not work
    if (process.env.VITAMIN_DISABLE_SANDBOX === '1') {
      app.commandLine.appendSwitch('no-sandbox');
      console.log('Sandbox disabled via VITAMIN_DISABLE_SANDBOX=1');
    } else {
      console.warn('Sandbox may be unavailable: unprivileged_userns_clone is 0');
    }
  }
} catch (e) {
  // If we can't check, keep sandbox on by default
}

// Check if in development mode
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;


// Auto-updater (only in production)
let autoUpdater = null;
if (!isDev) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    const log = require('electron-log');
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = 'info';
  } catch (err) {
    console.error('Auto-updater not available:', err);
  }
}

// Set app name (removes Electron branding)
app.setName('Vitamin');

// Ensure userData resolves to an app-specific directory (fixes NixOS appData edge case)
const appDataPath = app.getPath('appData');
const expectedUserDataPath = path.join(appDataPath, app.getName());
try {
  const userDataPath = app.getPath('userData');
  if (path.resolve(userDataPath) === path.resolve(appDataPath)) {
    app.setPath('userData', expectedUserDataPath);
  }
} catch (err) {
  app.setPath('userData', expectedUserDataPath);
}

// Storage paths
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const sessionPath = path.join(app.getPath('userData'), 'session.json');
const customPersonasPath = path.join(app.getPath('userData'), 'custom-personas.json');
const INTERNAL_HTML_DIR = path.resolve(__dirname, 'html');

function isInternalFileUrl(url) {
  if (!url || !url.startsWith('file://')) return false;
  try {
    const filePath = fileURLToPath(url);
    const resolvedPath = path.resolve(filePath);
    return resolvedPath.startsWith(INTERNAL_HTML_DIR + path.sep);
  } catch (err) {
    return false;
  }
}

function isTrustedSender(event) {
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || '';
  return isInternalFileUrl(senderUrl);
}

function denyIfUntrusted(event, channel) {
  if (isTrustedSender(event)) return false;
  const senderUrl = event?.senderFrame?.url || event?.sender?.getURL?.() || 'unknown';
  console.warn(`[SECURITY] Blocked ${channel} from ${senderUrl}`);
  return true;
}

function isSafeExternalUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (err) {
    return false;
  }
}

function normalizeNavigationInput(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return isSafeExternalUrl(trimmed) ? trimmed : null;
  }

  if (trimmed.includes('.') && !/\s/.test(trimmed)) {
    const candidate = `https://${trimmed}`;
    return isSafeExternalUrl(candidate) ? candidate : null;
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed)}`;
}

// Get performance metrics
function getPerformanceMetrics() {
  const cpuCount = os.cpus().length;
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const memUsagePercent = Math.round((usedMem / totalMem) * 100);

  // Get Electron process memory usage
  const processMemory = process.getProcessMemoryInfo ? process.getProcessMemoryInfo() : null;

  // Get all BrowserViews memory usage
  let totalTabMemory = 0;
  let tabCount = 0;

  if (tabViews) {
    for (const [tabId, view] of tabViews) {
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        tabCount++;
        // Note: We can't directly get memory per webContents in Electron
        // This would require implementing a more complex solution
      }
    }
  }

  // Get app metrics
  const appMetrics = app.getAppMetrics();
  const totalCPUUsage = appMetrics.reduce((sum, metric) => sum + (metric.cpu ? metric.cpu.percentCPUUsage : 0), 0);

  return {
    cpuCount,
    totalMem: Math.round(totalMem / (1024 * 1024)), // MB
    usedMem: Math.round(usedMem / (1024 * 1024)), // MB
    memUsagePercent,
    platform: process.platform,
    // Electron process memory (approximate)
    processMemory: processMemory ? {
      workingSetSize: Math.round(processMemory.workingSetSize / 1024), // MB
      peakWorkingSetSize: Math.round(processMemory.peakWorkingSetSize / 1024), // MB
      privateBytes: processMemory.privateBytes ? Math.round(processMemory.privateBytes / 1024) : 0, // MB
      sharedBytes: processMemory.sharedBytes ? Math.round(processMemory.sharedBytes / 1024) : 0 // MB
    } : null,
    // App metrics
    appMetrics: {
      totalCPUUsage: Math.round(totalCPUUsage * 100) / 100, // Percentage
      processCount: appMetrics.length
    },
    // Tab information
    tabCount: tabCount,
    performanceModeEnabled: settings.performanceMode
  };
}

const ALLOWED_THEMES = new Set(['dark', 'light', 'blueberry', 'acai', 'emerald']);

function normalizeTheme(theme) {
  return ALLOWED_THEMES.has(theme) ? theme : 'dark';
}

// Default settings
let settings = {
  frequency: 'medium',
  persona: null,
  theme: 'dark',
  adBlockEnabled: true,
  aggressiveAdBlock: true,
  autoUpdate: true,
  restoreSession: true,
  lastSeenVersion: null,
  // Privacy settings
  blockThirdPartyCookies: true,
  httpsOnly: false,
  blockWebRTC: true,
  blockFingerprinting: true,
  blockfingerprint: true,
  blockPopups: true,
  clearOnExit: false,
  // Performance settings
  performanceMode: false
};

// Generate theme injection script
function getThemeInjectionScript(theme) {
  const safeTheme = JSON.stringify(normalizeTheme(theme));
  return `
    try {
      const theme = ${safeTheme};
      localStorage.setItem('vitamin-theme', theme);
      if (typeof applyTheme === 'function') {
        applyTheme(theme);
      }
    } catch (err) {
      console.error('Failed to apply theme:', err);
    }
  `;
}

// Session storage
function loadSession() {
  try {
    if (fs.existsSync(sessionPath)) {
      const data = fs.readFileSync(sessionPath, 'utf8');
      // Check if file is empty
      if (!data || data.trim() === '') {
        console.log('Session file is empty, returning null');
        return null;
      }
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load session:', err.message);
    // If JSON parsing fails, remove the corrupted file
    if (err instanceof SyntaxError) {
      console.log('Removing corrupted session file');
      try {
        fs.unlinkSync(sessionPath);
      } catch (unlinkErr) {
        console.error('Failed to remove corrupted session file:', unlinkErr.message);
      }
    }
  }
  return null;
}

function saveSession() {
  try {
    const sessionData = {
      tabs: tabs.map(t => ({ url: t.url, title: t.title })),
      activeTabId: activeTabId
    };
    fs.writeFileSync(sessionPath, JSON.stringify(sessionData, null, 2));
    console.log(`Saved session with ${tabs.length} tabs`);
  } catch (err) {
    console.error('Failed to save session:', err);
  }
}

// Downloads tracking
let downloads = [];

function isKnownDownloadPath(savePath) {
  if (typeof savePath !== 'string' || savePath.length === 0) return false;
  return downloads.some(download => download.savePath === savePath);
}

// Custom personas storage
let customPersonas = [];

function loadCustomPersonas() {
  try {
    if (fs.existsSync(customPersonasPath)) {
      const data = fs.readFileSync(customPersonasPath, 'utf8');
      customPersonas = JSON.parse(data);
      console.log(`Loaded ${customPersonas.length} custom personas`);
    }
  } catch (err) {
    console.error('Error loading custom personas:', err);
    customPersonas = [];
  }
}

function saveCustomPersonas() {
  try {
    fs.writeFileSync(customPersonasPath, JSON.stringify(customPersonas, null, 2));
  } catch (err) {
    console.error('Error saving custom personas:', err);
  }
}

// Release notes for "What's New" dialog
// Release notes cache (fetched from GitHub Releases API)
let releaseNotesCache = {};
const GITHUB_REPO = 'realvitali/vitamin-browser';

// Fetch release notes from GitHub
async function fetchReleaseNotes() {
  try {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`);
    if (!response.ok) return {};

    const releases = await response.json();
    const notes = {};

    for (const release of releases) {
      // Extract version from tag (remove 'v' prefix if present)
      const version = release.tag_name.replace(/^v/, '');
      // Parse markdown body into bullet points
      const body = release.body || '';
      const bullets = body
        .split('\n')
        .map(line => line.replace(/^[-*]\s*/, '').trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));
      notes[version] = bullets;
    }

    releaseNotesCache = notes;
    return notes;
  } catch (err) {
    console.error('Failed to fetch release notes:', err.message);
    return releaseNotesCache;
  }
}

// Get release notes (from cache or fetch)
function getReleaseNotes() {
  return releaseNotesCache;
}

function getReleaseNotesForVersion(version) {
  return releaseNotesCache[version] || [];
}
// Onboarding window
let onboardingWindow = null;

function showOnboardingWindow() {
  // If onboarding window already exists, focus it
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.focus();
    return;
  }

  onboardingWindow = new BrowserWindow({
    width: 700,
    height: 600,
    parent: mainWindow,
    modal: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      webSecurity: true,
      enableRemoteModule: false,
      spellcheck: false
    },
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    autoHideMenuBar: true
  });

  onboardingWindow.loadFile('html/onboarding.html');

  // Handle messages from onboarding window
  const handleOnboardingMessage = (event, message) => {
    if (message === 'complete-onboarding') {
      settings.onboardingComplete = true;
      saveSettings();
      if (onboardingWindow) {
        onboardingWindow.destroy();
        onboardingWindow = null;
      }
    }
  };

  // Set up IPC listener for onboarding completion
  ipcMain.once('complete-onboarding', handleOnboardingMessage);

  // Clean up listener when window is closed
  onboardingWindow.on('closed', () => {
    ipcMain.removeListener('complete-onboarding', handleOnboardingMessage);
    onboardingWindow = null;

    // Ensure main window is focused after onboarding
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (process.platform === 'linux') {
        // Delay focus slightly on Linux for better WM compatibility
        setTimeout(() => {
          mainWindow.focus();
        }, 100);
      } else {
        mainWindow.focus();
      }
    }
  });

  onboardingWindow.once('ready-to-show', () => {
    onboardingWindow.show();
    onboardingWindow.focus();
  });

  // Ensure onboarding window stays on top (but be less aggressive on Linux)
  if (process.platform !== 'linux') {
    onboardingWindow.on('blur', () => {
      if (onboardingWindow) {
        onboardingWindow.focus();
      }
    });
  }
}

// Load settings from file
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) {
      const data = fs.readFileSync(settingsPath, 'utf8');
      settings = { ...settings, ...JSON.parse(data) };
      settings.theme = normalizeTheme(settings.theme);
    }
  } catch (err) {
    console.error('Failed to load settings:', err);
  }
}

// Save settings to file
function saveSettings() {
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to save settings:', err);
  }
}

// Favicon cache path
const faviconCachePath = path.join(app.getPath('userData'), 'favicons');

// Initialize favicon cache directory
function initFaviconCache() {
  if (!fs.existsSync(faviconCachePath)) {
    fs.mkdirSync(faviconCachePath, { recursive: true });
  }
}

// Generate a safe filename for caching favicons
function getFaviconCacheFilename(url) {
  // Create a hash of the URL for the filename
  const hash = require('crypto').createHash('md5').update(url).digest('hex');
  return `${hash}.png`;
}

// Save favicon to cache
function cacheFavicon(url, data) {
  try {
    const filename = getFaviconCacheFilename(url);
    const filepath = path.join(faviconCachePath, filename);
    fs.writeFileSync(filepath, data);
    // console.log(`Favicon cached: ${url}`); // Reduced verbosity
  } catch (err) {
    console.error(`Failed to cache favicon for ${url}:`, err.message);
  }
}

// Load favicon from cache
function loadFaviconFromCache(url) {
  try {
    const filename = getFaviconCacheFilename(url);
    const filepath = path.join(faviconCachePath, filename);
    if (fs.existsSync(filepath)) {
      return fs.readFileSync(filepath);
    }
  } catch (err) {
    console.error(`Failed to load cached favicon for ${url}:`, err.message);
  }
  return null;
}

// Download and cache a favicon
async function downloadAndCacheFavicon(url) {
  try {
    // Check if already cached
    if (loadFaviconFromCache(url)) {
      // console.log(`Favicon already cached: ${url}`); // Reduced verbosity
      return;
    }

    // Download the favicon
    const response = await net.fetch(url);
    if (response.ok) {
      // Use arrayBuffer() instead of buffer() for modern Electron
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      cacheFavicon(url, buffer);
    } else {
      console.error(`Failed to download favicon ${url}: ${response.status} ${response.statusText}`);
    }
  } catch (err) {
    console.error(`Failed to download favicon ${url}:`, err.message);
  }
}

// Privacy hardening - apply to session
function applyPrivacySettings() {
  const ses = session.defaultSession;

  // Block third-party cookies
  if (settings.blockThirdPartyCookies) {
    ses.cookies.on('changed', (event, cookie, cause, removed) => {
      // Log but don't interfere with first-party cookies
    });
  }

  // WebRTC leak protection - disable local IP discovery
  if (settings.blockWebRTC) {
    ses.setPermissionRequestHandler((webContents, permission, callback) => {
      // Block WebRTC-related permissions by default
      if (permission === 'media') {
        callback(false);
        return;
      }
      // Block geolocation by default
      if (permission === 'geolocation') {
        callback(false);
        return;
      }
      // Block notifications by default
      if (permission === 'notifications') {
        callback(false);
        return;
      }
      callback(true);
    });
  }

  // HTTPS upgrading + adblock handler
  // Note: Palantir blocking is handled at the webContents level (will-navigate, createTab, navigate IPC)
  ses.webRequest.onBeforeRequest((details, callback) => {
    // HTTPS upgrading - only if enabled and for http:// URLs
    if (settings.httpsOnly && details.url.startsWith('http://')) {
      const url = new URL(details.url);
      // Skip localhost and local IPs
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.startsWith('192.168.')) {
        callback({ cancel: false });
        return;
      }
      // Upgrade to HTTPS
      const httpsUrl = details.url.replace('http://', 'https://');
      callback({ redirectURL: httpsUrl });
      return;
    }

    if (adblockModule.handleBeforeRequest(details, callback)) {
      return;
    }

    callback({ cancel: false });
  });

  ses.webRequest.onHeadersReceived((details, callback) => {
    if (adblockModule.handleHeadersReceived(details, callback)) {
      return;
    }
    callback({ responseHeaders: details.responseHeaders });
  });

  // Log failed requests for debugging
  if (settings.httpsOnly) {
    ses.webRequest.onErrorOccurred((details) => {
      if (details.error === 'net::ERR_CONNECTION_CLOSED') {
        console.log(`Connection closed error details:`, {
          url: details.url,
          type: details.resourceType,
          timestamp: details.timestamp
        });
      }
    });
  }

  // Set secure defaults
  const normalizedUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const chromeMajorMatch = normalizedUserAgent.match(/Chrome\/(\d+)\./);
  const chromeMajor = chromeMajorMatch ? chromeMajorMatch[1] : '120';
  const secChUa = `"Not=A?Brand";v="24", "Chromium";v="${chromeMajor}", "Google Chrome";v="${chromeMajor}"`;
  ses.setUserAgent(normalizedUserAgent);

  // Set consistent preferences to avoid dark mode conflicts
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    // Force light mode preference for websites to prevent dark mode rendering issues
    details.requestHeaders['Accept'] = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
    details.requestHeaders['Accept-Language'] = 'en-US,en;q=0.9';
    details.requestHeaders['Accept-Encoding'] = 'gzip, deflate, br';
    details.requestHeaders['DNT'] = '1';
    details.requestHeaders['Sec-GPC'] = '1';
    details.requestHeaders['Sec-CH-Prefers-Color-Scheme'] = 'light';
    Object.keys(details.requestHeaders).forEach((header) => {
      if (header.toLowerCase().startsWith('sec-ch-ua')) {
        delete details.requestHeaders[header];
      }
    });
    details.requestHeaders['Sec-CH-UA'] = secChUa;
    details.requestHeaders['Sec-CH-UA-Mobile'] = '?0';
    details.requestHeaders['Sec-CH-UA-Platform'] = '"Windows"';
    callback({ requestHeaders: details.requestHeaders });
  });

  console.log('Privacy settings applied');
}

// Clear browsing data on exit
function clearBrowsingData() {
  if (!settings.clearOnExit) return;

  const ses = session.defaultSession;
  ses.clearStorageData({
    storages: ['cookies', 'localstorage', 'sessionstorage', 'cachestorage', 'indexdb', 'websql', 'serviceworkers']
  });
  ses.clearCache();
  console.log('Browsing data cleared');
}
let mainWindow;
let poisonViews = []; // Hidden views for poisoning

// Tab management
let tabs = []; // Array of { id, title, url }
let tabViews = new Map(); // Map<tabId, BrowserView>
let activeTabId = null;
let nextTabId = 1;

function createWindow() {
  // Get screen dimensions to center the window
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Window size - about half screen size, minimum 1000x700
  const windowWidth = Math.max(1000, Math.floor(screenWidth * 0.6));
  const windowHeight = Math.max(700, Math.floor(screenHeight * 0.7));

  // Center position
  const x = Math.floor((screenWidth - windowWidth) / 2);
  const y = Math.floor((screenHeight - windowHeight) / 2);

  const isMac = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: x,
    y: y,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableRemoteModule: false,
      spellcheck: false
    },
    // macOS: hidden title bar with traffic lights
    // Linux/Windows: frameless with custom window controls
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    frame: isMac, // Frameless on Linux/Windows, native traffic lights on macOS
    autoHideMenuBar: true, // Hide menu bar on Linux (press Alt to show)
    backgroundColor: '#0a0a0a',
    show: false, // Don't show until content is ready
    title: 'Vitamin',
    icon: path.join(__dirname, 'assets/icon.png')
  });

  // Load the browser UI
  mainWindow.loadFile('html/index.html');

  // Show window immediately to prevent startup delay
  mainWindow.webContents.once('dom-ready', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  mainWindow.on('resize', updateActiveTabBounds);

  // Restore session or create first tab
  let restoredSession = false;
  if (settings.restoreSession) {
    const savedSession = loadSession();
    if (savedSession && savedSession.tabs && savedSession.tabs.length > 0) {
      savedSession.tabs.forEach((tab, index) => {
        const url = tab.url && !tab.url.startsWith('file://') ? tab.url : null;
        createTab(url);
      });
      restoredSession = true;
      console.log(`Restored session with ${savedSession.tabs.length} tabs`);
    }
  }

  // Create first tab if no session restored
  if (!restoredSession) {
    // Small delay to ensure settings are fully loaded
    setTimeout(() => {
      createTab();
    }, 100);
  }

  // Set up keyboard shortcuts via menu
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => createTab()
        },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (activeTabId) closeTab(activeTabId);
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            if (mainWindow) {
              mainWindow.webContents.send('toggle-find-bar');
            }
          }
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Tab',
          click: () => {
            if (tabs.length > 1) {
              const currentIndex = tabs.findIndex(t => t.id === activeTabId);
              const nextIndex = (currentIndex + 1) % tabs.length;
              switchToTab(tabs[nextIndex].id);
            }
          }
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+Tab',
          click: () => {
            if (tabs.length > 1) {
              const currentIndex = tabs.findIndex(t => t.id === activeTabId);
              const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
              switchToTab(tabs[prevIndex].id);
            }
          }
        },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Track panel state for resize handling
let leftPanelOpen = false;
let rightPanelOpen = false;
let dashboardVisible = false;

function updateActiveTabBounds() {
  if (!mainWindow || !activeTabId) return;
  const view = tabViews.get(activeTabId);
  if (!view) return;

  const bounds = mainWindow.getBounds();

  // Adjust for open panels
  let x = 0;
  let width = bounds.width;
  // Default: just toolbar (52px), with dashboard: 105px
  let y = dashboardVisible ? 105 : 52;

  if (leftPanelOpen) {
    x = 320;
    width = bounds.width - 320;
  } else if (rightPanelOpen) {
    width = bounds.width - 320;
  }

  // Ensure the view covers the entire available area exactly
  view.setBounds({
    x: x,
    y: y,
    width: width,
    height: bounds.height - y
  });
}

const fingerprintInjectedContents = new WeakSet();

function registerFingerprintProtection(webContents) {
  if (!settings.blockFingerprinting || !fingerprintProtectionScript) return;
  if (!webContents || webContents.isDestroyed()) return;
  if (fingerprintInjectedContents.has(webContents)) return;

  let injected = false;
  if (typeof webContents.addScriptToEvaluateOnNewDocument === 'function') {
    try {
      webContents.addScriptToEvaluateOnNewDocument(fingerprintProtectionScript);
      injected = true;
    } catch (err) {
      console.error('Failed to register fingerprint protection:', err.message);
    }
  }

  if (!injected && webContents.debugger) {
    try {
      if (!webContents.debugger.isAttached()) {
        webContents.debugger.attach('1.3');
      }
      void webContents.debugger.sendCommand('Page.enable').catch((err) => {
        console.error('Failed to enable Page domain for fingerprint protection:', err.message);
      });
      void webContents.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument', {
        source: fingerprintProtectionScript
      }).catch((err) => {
        console.error('Failed to add fingerprint script via debugger:', err.message);
      });
      injected = true;
    } catch (err) {
      console.error('Failed to register fingerprint protection via debugger:', err.message);
    }
  }

  if (injected) {
    fingerprintInjectedContents.add(webContents);
  }
}

function createTab(url = null) {
  const tabId = nextTabId++;
  const view = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-start.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      enableRemoteModule: false,
      spellcheck: false,
      session: session.defaultSession  // Ensure we use the default session where request handlers are registered
    },
    backgroundColor: '#0a0a0a'
  });

  // Store tab data
  const tab = {
    id: tabId,
    title: 'New Tab',
    url: '',
    favicon: ''
  };
  tabs.push(tab);
  tabViews.set(tabId, view);

  registerFingerprintProtection(view.webContents);

  view.webContents.setWindowOpenHandler((details) => {
    if (!settings.adBlockEnabled || !settings.blockPopups) {
      return { action: 'allow' };
    }

    const targetUrl = details.url || '';
    if (!isSafeExternalUrl(targetUrl)) {
      console.log('[POPUP] Blocked unsafe popup:', targetUrl);
      return { action: 'deny' };
    }

    let sameOrigin = false;
    try {
      const sourceUrl = view.webContents.getURL();
      sameOrigin = new URL(sourceUrl).origin === new URL(targetUrl).origin;
    } catch (err) {
      sameOrigin = false;
    }

    if (details.userGesture && sameOrigin) {
      console.log('[POPUP] Redirecting popup to current tab:', targetUrl);
      view.webContents.loadURL(targetUrl);
      return { action: 'deny' };
    }

    console.log('[POPUP] Blocked popup:', targetUrl);
    return { action: 'deny' };
  });

  // Apply performance mode if enabled
  if (settings.performanceMode) {
    applyPerformanceModeToView(view, true);
  }

  // Set view bounds immediately to prevent flash
  if (mainWindow) {
    const bounds = mainWindow.getBounds();
    // Default: just toolbar (52px)
    let y = 52;
    let x = 0;
    let width = bounds.width;
    let height = bounds.height - y;

    view.setBounds({ x, y, width, height });
  }

  // Intercept navigation to Palantir URLs BEFORE they happen
  let handlingPalantir = false;
  view.webContents.on('will-navigate', (event, url) => {
    // Skip internal file:// URLs to avoid loops
    if (url.startsWith('file://')) return;
    // Prevent re-entry while handling
    if (handlingPalantir) return;

    if (url.includes('palantir.com')) {
      console.log('[PALANTIR] Blocking navigation to Palantir URL:', url);
      handlingPalantir = true;
      event.preventDefault();
      const palantirInfo = encodeURIComponent(JSON.stringify({ url: url }));
      view.webContents.loadFile('html/palantir.html', { hash: palantirInfo });
      // Reset flag after a short delay
      setTimeout(() => { handlingPalantir = false; }, 500);
    }
  });


  // Set up navigation listeners for this tab
  view.webContents.on('did-navigate', (event, url) => {
    tab.url = url;
    const displayUrl = url.startsWith('file://') ? '' : url;

    // Update title from page (getTitle returns string, not promise)
    const title = view.webContents.getTitle();
    tab.title = title || 'New Tab';
    sendTabsUpdate();

    // Add to history
    historyModule.add(url, tab.title);

    // If this is the active tab, update URL bar
    if (tabId === activeTabId) {
      mainWindow.webContents.send('url-changed', displayUrl);
    }

    // Apply theme only to internal pages after navigation
    const theme = settings.theme;
    const isInternalPage = url.startsWith('file://');
    if (isInternalPage) {
      view.webContents.executeJavaScript(getThemeInjectionScript(theme));
    } else if (settings.blockFingerprinting && fingerprintProtectionScript) {
      // Inject fingerprint protection for external pages
      console.log(`[FINGERPRINT] Injecting protection script for tab ${tabId} URL: ${url}`);
      view.webContents.executeJavaScript(fingerprintProtectionScript).then(() => {
        console.log(`[FINGERPRINT] Successfully injected protection script for tab ${tabId}`);
      }).catch((err) => {
        console.error(`[FINGERPRINT] Failed to inject protection script for tab ${tabId}:`, err.message);
      });
    }
  });

  // Also inject fingerprint protection on dom-ready for external pages
  view.webContents.on('dom-ready', (event) => {
    const url = view.webContents.getURL();
    if (!url.startsWith('file://') && settings.blockFingerprinting && fingerprintProtectionScript) {
      console.log(`[FINGERPRINT] Injecting protection script on dom-ready for tab ${tabId} URL: ${url}`);
      view.webContents.executeJavaScript(fingerprintProtectionScript).then(() => {
        console.log(`[FINGERPRINT] Successfully injected protection script on dom-ready for tab ${tabId}`);
      }).catch((err) => {
        console.error(`[FINGERPRINT] Failed to inject protection script on dom-ready for tab ${tabId}:`, err.message);
      });
    }
  });

  view.webContents.on('did-navigate-in-page', (event, url) => {
    tab.url = url;
    const displayUrl = url.startsWith('file://') ? '' : url;
    if (tabId === activeTabId) {
      mainWindow.webContents.send('url-changed', displayUrl);
    }

    // Apply theme only to internal pages
    const theme = settings.theme;
    const isInternalPage = url.startsWith('file://');
    if (isInternalPage) {
      view.webContents.executeJavaScript(getThemeInjectionScript(theme));
    }
  });

  view.webContents.on('page-title-updated', (event, title) => {
    tab.title = title || 'New Tab';
    sendTabsUpdate();
  });

  view.webContents.on('page-favicon-updated', (event, favicons) => {
    if (favicons && favicons.length > 0) {
      const faviconUrl = favicons[0];
      tab.favicon = faviconUrl;

      // Download and cache the favicon
      downloadAndCacheFavicon(faviconUrl).catch(err => {
        console.error(`Failed to download favicon ${faviconUrl}:`, err.message);
      });

      sendTabsUpdate();
    }
  });

  // Loading progress events
  view.webContents.on('did-start-loading', () => {
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('loading-start');
    }
  });

  view.webContents.on('did-stop-loading', () => {
    if (tabId === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('loading-stop');
    }
  });

  // Handle page load errors - show cute kitty error page
  view.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // Ignore aborted loads (user navigated away) and cancelled loads
    if (errorCode === -3 || errorCode === -1) return;
    // Don't show error for file:// URLs (internal pages)
    if (validatedURL && validatedURL.startsWith('file://')) return;

    console.log(`Page load failed: ${errorDescription} (${errorCode}) - ${validatedURL} (main frame: ${isMainFrame})`);

    // Special handling for connection closed errors (-100)
    if (errorCode === -100) {
      console.log(`Connection closed error for ${validatedURL}. This could be due to:`, {
        httpsOnly: settings.httpsOnly,
        blockThirdPartyCookies: settings.blockThirdPartyCookies,
        userAgent: view.webContents.getUserAgent()
      });
    }

    // Special handling for blocked by client errors (-20 or -354)
    // -20 = ERR_BLOCKED_BY_CLIENT (ad blocker)
    // -354 = ERR_CONTENT_DECODING_FAILED (can also be caused by aggressive blocking)
    // Only show blocked page for main frame errors
    if ((errorCode === -20 || errorCode === -354) && isMainFrame) {
      console.log(`Page blocked by client: ${validatedURL}`);
      // Show special blocked page with "Proceed Anyway" option
      const blockedInfo = encodeURIComponent(JSON.stringify({
        url: validatedURL,
        reason: 'blocked-by-adblocker',
        blockedCount: blockedCount
      }));
      // Use loadURL with file:// protocol to ensure correct path resolution
      const blockedPageUrl = `file://${__dirname}/html/blocked.html#${blockedInfo}`;
      view.webContents.loadURL(blockedPageUrl);
      return;
    }

    // Pass error info via URL hash (only for main frame errors)
    if (isMainFrame) {
      const errorInfo = encodeURIComponent(JSON.stringify({
        code: errorCode,
        description: errorDescription,
        url: validatedURL
      }));
      // Use loadURL with file:// protocol to ensure correct path resolution
      const errorPageUrl = `file://${__dirname}/html/error.html#${errorInfo}`;
      view.webContents.loadURL(errorPageUrl);
    }
  });

  // Find in page results
  view.webContents.on('found-in-page', (event, result) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('found-in-page', result);
    }
  });

  // Right-click context menu
  view.webContents.on('context-menu', (event, params) => {
    const menuItems = [];

    // Link actions
    if (params.linkURL) {
      menuItems.push({
        label: 'Open Link in New Tab',
        click: () => createTab(params.linkURL)
      });
      menuItems.push({
        label: 'Copy Link',
        click: () => require('electron').clipboard.writeText(params.linkURL)
      });
      menuItems.push({
        label: 'Download Link',
        click: () => view.webContents.downloadURL(params.linkURL)
      });
      menuItems.push({ type: 'separator' });
    }

    // Image actions
    if (params.srcURL && params.mediaType === 'image') {
      menuItems.push({
        label: 'Save Image',
        click: () => view.webContents.downloadURL(params.srcURL)
      });
      menuItems.push({
        label: 'Copy Image URL',
        click: () => require('electron').clipboard.writeText(params.srcURL)
      });
      menuItems.push({ type: 'separator' });
    }

    // Text selection
    if (params.selectionText) {
      menuItems.push({
        label: 'Copy',
        click: () => view.webContents.copy()
      });
      menuItems.push({
        label: 'Search for "' + params.selectionText.slice(0, 20) + (params.selectionText.length > 20 ? '...' : '') + '"',
        click: () => createTab('https://duckduckgo.com/?q=' + encodeURIComponent(params.selectionText))
      });
      menuItems.push({ type: 'separator' });
    }

    // Standard actions
    menuItems.push({
      label: 'Back',
      enabled: view.webContents.canGoBack(),
      click: () => view.webContents.goBack()
    });
    menuItems.push({
      label: 'Forward',
      enabled: view.webContents.canGoForward(),
      click: () => view.webContents.goForward()
    });
    menuItems.push({
      label: 'Reload',
      click: () => view.webContents.reload()
    });

    if (menuItems.length > 0) {
      Menu.buildFromTemplate(menuItems).popup();
    }
  });

  // Load URL or start page
  if (url) {
    const normalizedUrl = normalizeNavigationInput(url);
    url = normalizedUrl || null;
  }

  if (url) {
    // Set background color immediately to prevent flash
    view.setBackgroundColor('#0a0a0a');

    // Check for Palantir URLs and show fun error page instead
    if (url.includes('palantir.com')) {
      console.log('[PALANTIR] Blocked tab creation with Palantir URL:', url);
      const palantirInfo = encodeURIComponent(JSON.stringify({ url: url }));
      view.webContents.loadFile('html/palantir.html', { hash: palantirInfo });
    } else {
      ensureAdblockReadyForUrl(url).finally(() => {
        if (!view.webContents.isDestroyed()) {
          view.webContents.loadURL(url);
        }
      });
    }
  } else {
    view.webContents.loadFile('html/start.html');

    // Send theme and version to start page when it's loaded
    view.webContents.once('dom-ready', () => {
      const theme = normalizeTheme(settings.theme);
      const version = app.getVersion();
      const safeTheme = JSON.stringify(theme);
      const safeVersion = JSON.stringify(version);
      view.webContents.send('theme-change', theme);
      // Also directly apply theme and version via JavaScript to ensure it's applied
      view.webContents.executeJavaScript(`
        try {
          const theme = ${safeTheme};
          const version = ${safeVersion};
          const allThemeClasses = ['light', 'blueberry', 'acai', 'emerald'];
          allThemeClasses.forEach(cls => document.body.classList.remove(cls));
          if (theme !== 'dark') {
            document.body.classList.add(theme);
          } else {
            // For dark theme, ensure we have the right styling
            document.body.classList.remove('light', 'blueberry', 'acai', 'emerald');
          }
          localStorage.setItem('vitamin-theme', theme);
          // Set version
          const versionEl = document.getElementById('app-version');
          if (versionEl) versionEl.textContent = 'v' + version;

          // Ensure proper background color
          document.body.style.backgroundColor = theme === 'light' ? '#ffffff' : '#0a0a0a';

          // Apply theme if applyTheme function exists
          if (typeof applyTheme === 'function') {
            applyTheme(theme);
          }
        } catch (err) {
          console.error('Failed to apply initial theme:', err);
        }
      `);
    });
  }

  // Switch to new tab
  switchToTab(tabId);

  // Send theme change immediately to ensure it's applied
  setTimeout(() => {
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('theme-change', settings.theme);
    }
  }, 50);

  return tabId;
}

function switchToTab(tabId) {
  const view = tabViews.get(tabId);
  if (!view || view.webContents.isDestroyed()) return;

  activeTabId = tabId;
  mainWindow.setBrowserView(view);
  updateActiveTabBounds();

  // Update URL bar
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    const displayUrl = tab.url.startsWith('file://') ? '' : tab.url;
    mainWindow.webContents.send('url-changed', displayUrl);
  }

  // Send current theme to the tab when switching to it (only for internal pages)
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    const currentUrl = view.webContents.getURL();
    const isInternalPage = currentUrl.startsWith('file://') || currentUrl === '';

    // Only modify internal pages - don't touch external websites
    if (isInternalPage) {
      const theme = normalizeTheme(settings.theme);
      const safeTheme = JSON.stringify(theme);
      view.setBackgroundColor('#0a0a0a');
      view.webContents.send('theme-change', theme);
      view.webContents.executeJavaScript(`
        try {
          const theme = ${safeTheme};
          const allThemeClasses = ['light', 'blueberry', 'acai', 'emerald'];
          allThemeClasses.forEach(cls => document.body.classList.remove(cls));
          if (theme !== 'dark') {
            document.body.classList.add(theme);
          }
          localStorage.setItem('vitamin-theme', theme);
          if (typeof applyTheme === 'function') {
            applyTheme(theme);
          }
        } catch (err) {
          console.error('Failed to apply theme on tab switch:', err);
        }
      `);
    }
  }

  sendTabsUpdate();
}

function closeTab(tabId) {
  const index = tabs.findIndex(t => t.id === tabId);
  if (index === -1) return;

  // Don't close last tab - create new one instead
  if (tabs.length === 1) {
    // Reset current tab to start page
    const view = tabViews.get(tabId);
    if (view) {
      view.webContents.loadFile('html/start.html');
      tabs[0].title = 'New Tab';
      tabs[0].url = '';
      sendTabsUpdate();
      // Apply theme and version after page loads
      view.webContents.once('dom-ready', () => {
        const theme = normalizeTheme(settings.theme);
        const version = app.getVersion();
        const safeTheme = JSON.stringify(theme);
        const safeVersion = JSON.stringify(version);
        view.webContents.send('theme-change', theme);
        view.webContents.executeJavaScript(`
          try {
            const theme = ${safeTheme};
            const version = ${safeVersion};
            const allThemeClasses = ['light', 'blueberry', 'acai', 'emerald'];
            allThemeClasses.forEach(cls => document.body.classList.remove(cls));
            if (theme !== 'dark') {
              document.body.classList.add(theme);
            } else {
              // For dark theme, ensure we have the right styling
              document.body.classList.remove('light', 'blueberry', 'acai', 'emerald');
            }
            localStorage.setItem('vitamin-theme', theme);
            // Set version
            const versionEl = document.getElementById('app-version');
            if (versionEl) versionEl.textContent = 'v' + version;

            // Ensure proper background color
            document.body.style.backgroundColor = theme === 'light' ? '#ffffff' : '#0a0a0a';

            // Apply theme if applyTheme function exists
            if (typeof applyTheme === 'function') {
              applyTheme(theme);
            }
          } catch (err) {
            console.error('Failed to apply theme on reset:', err);
          }
        `);
      });
    }
    return;
  }

  // Remove tab
  tabs.splice(index, 1);
  const view = tabViews.get(tabId);
  if (view) {
    // Check if the view's webContents is already destroyed
    if (!view.webContents.isDestroyed()) {
      view.webContents.destroy();
    }
  }
  tabViews.delete(tabId);

  // Switch to adjacent tab if this was active
  if (tabId === activeTabId) {
    const newIndex = Math.min(index, tabs.length - 1);
    const newTabId = tabs[newIndex].id;
    // Verify the new tab view exists and is not destroyed before switching
    const newView = tabViews.get(newTabId);
    if (newView && !newView.webContents.isDestroyed()) {
      switchToTab(newTabId);
    } else {
      // If the new view is destroyed or doesn't exist, try to find any valid tab
      const validTab = tabs.find(t => {
        const tabView = tabViews.get(t.id);
        return tabView && !tabView.webContents.isDestroyed();
      });
      if (validTab) {
        switchToTab(validTab.id);
      } else if (tabs.length > 0) {
        // Create a new tab if no valid tabs exist
        createTab();
      }
    }
  } else {
    sendTabsUpdate();
  }
}

function sendTabsUpdate() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('tabs-update', {
    tabs: tabs.map(t => ({ id: t.id, title: t.title, favicon: t.favicon })),
    activeTabId
  });
}

function getActiveView() {
  return tabViews.get(activeTabId);
}

async function ensureAdblockReadyForUrl(url) {
  if (!settings.adBlockEnabled) return;
  if (!isSafeExternalUrl(url)) return;
  try {
    await adblockModule.waitUntilReady();
  } catch (err) {
    console.error('Ad blocker readiness check failed:', err.message);
  }
}

// Navigation handlers
ipcMain.on('navigate', async (event, url) => {
  if (denyIfUntrusted(event, 'navigate')) return;
  const view = getActiveView();
  if (!view) return;

  const finalUrl = normalizeNavigationInput(url);
  if (!finalUrl) return;

  // Check for Palantir URLs and show fun error page instead
  if (finalUrl.includes('palantir.com')) {
    console.log('[PALANTIR] Intercepted navigation to Palantir:', finalUrl);
    const palantirInfo = encodeURIComponent(JSON.stringify({ url: finalUrl }));
    view.webContents.loadFile('html/palantir.html', { hash: palantirInfo });
    return;
  }

  await ensureAdblockReadyForUrl(finalUrl);
  view.webContents.loadURL(finalUrl);
});

ipcMain.on('go-back', () => {
  const view = getActiveView();
  if (view && view.webContents.canGoBack()) {
    view.webContents.goBack();
  }
});

ipcMain.on('go-forward', () => {
  const view = getActiveView();
  if (view && view.webContents.canGoForward()) {
    view.webContents.goForward();
  }
});

// Handle search requests from start page
ipcMain.on('search-request', (event, query) => {
  if (denyIfUntrusted(event, 'search-request')) return;
  const safeQuery = typeof query === 'string' ? query : '';
  const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(safeQuery)}`;

  // If we're on the start page (no tabs), create a new tab with the search
  if (tabs.length === 0) {
    createTab(searchUrl);
  } else {
    // Navigate the current tab to the search URL
    const view = getActiveView();
    if (view) {
      // Set background color immediately to prevent flash
      view.setBackgroundColor('#0a0a0a');
      ensureAdblockReadyForUrl(searchUrl).finally(() => {
        if (!view.webContents.isDestroyed()) {
          view.webContents.loadURL(searchUrl);
        }
      });
    }
  }
});

// Handle "Proceed Anyway" for Palantir URLs
ipcMain.on('proceed-palantir-url', (event, url) => {
  if (denyIfUntrusted(event, 'proceed-palantir-url')) return;
  const view = getActiveView();
  if (!view || !url) return;
  if (!isSafeExternalUrl(url)) return;

  console.log('Proceeding to Palantir URL without filtering:', url);

  // Navigate to the URL without any filtering
  view.webContents.loadURL(url);
});

// Handle "Proceed Anyway" for blocked URLs (error -20)
ipcMain.on('proceed-blocked-url', (event, url) => {
  if (denyIfUntrusted(event, 'proceed-blocked-url')) return;
  const view = getActiveView();
  if (!view || !url) return;
  if (!isSafeExternalUrl(url)) return;

  console.log('Proceeding to blocked URL with all blocking temporarily disabled:', url);

  // Temporarily disable all blocking mechanisms
  const wasAdBlockingEnabled = adBlockingEnabled;
  const wasFingerprintingBlocked = settings.blockFingerprinting;

  if (wasAdBlockingEnabled) {
    disableAdBlocking();
  }

  // Temporarily disable fingerprinting protection
  if (wasFingerprintingBlocked) {
    settings.blockFingerprinting = false;
  }

  // Navigate to the URL
  view.webContents.loadURL(url);

  // Re-enable all blocking after page finishes loading
  view.webContents.once('did-finish-load', () => {
    // Re-enable ad blocking
    if (wasAdBlockingEnabled) {
      enableAdBlocking();
      console.log('Ad blocking re-enabled after page load');
    }

    // Re-enable fingerprinting protection
    if (wasFingerprintingBlocked) {
      settings.blockFingerprinting = true;
      console.log('Fingerprinting protection re-enabled after page load');
    }
  });

  // Fallback: re-enable after timeout in case page never finishes
  setTimeout(() => {
    if (wasAdBlockingEnabled && !adBlockingEnabled) {
      enableAdBlocking();
      console.log('Ad blocking re-enabled after timeout');
    }

    if (wasFingerprintingBlocked && !settings.blockFingerprinting) {
      settings.blockFingerprinting = true;
      console.log('Fingerprinting protection re-enabled after timeout');
    }
  }, 30000);
});

ipcMain.on('refresh', () => {
  const view = getActiveView();
  if (view) {
    // Use reloadIgnoringCache for a hard refresh (works better with service workers)
    view.webContents.reloadIgnoringCache();
    // Only re-apply theme to internal pages (not external websites)
    view.webContents.once('dom-ready', () => {
      const currentUrl = view.webContents.getURL();
      const isInternalPage = currentUrl.startsWith('file://');

      if (isInternalPage) {
        const theme = normalizeTheme(settings.theme);
        const version = app.getVersion();
        const safeTheme = JSON.stringify(theme);
        const safeVersion = JSON.stringify(version);
        view.webContents.send('theme-change', theme);
        view.webContents.executeJavaScript(`
          try {
            const theme = ${safeTheme};
            const version = ${safeVersion};
            const allThemeClasses = ['light', 'blueberry', 'acai', 'emerald'];
            allThemeClasses.forEach(cls => document.body.classList.remove(cls));
            if (theme !== 'dark') {
              document.body.classList.add(theme);
            } else {
              document.body.classList.remove('light', 'blueberry', 'acai', 'emerald');
            }
            localStorage.setItem('vitamin-theme', theme);
            const versionEl = document.getElementById('app-version');
            if (versionEl) versionEl.textContent = 'v' + version;
            document.body.style.backgroundColor = theme === 'light' ? '#ffffff' : '#0d0d0d';
            if (typeof applyTheme === 'function') {
              applyTheme(theme);
            }
          } catch (err) {
            console.error('Failed to apply theme on refresh:', err);
          }
        `);
      }
    });
  }
});

ipcMain.on('go-home', () => {
  const view = getActiveView();
  if (view) {
    view.webContents.loadFile('html/start.html');
    // Apply theme and version after start page loads
    view.webContents.once('dom-ready', () => {
      const theme = normalizeTheme(settings.theme);
      const version = app.getVersion();
      const safeTheme = JSON.stringify(theme);
      const safeVersion = JSON.stringify(version);
      view.webContents.send('theme-change', theme);
      view.webContents.executeJavaScript(`
        try {
          const theme = ${safeTheme};
          const version = ${safeVersion};
          const allThemeClasses = ['light', 'blueberry', 'acai', 'emerald'];
          allThemeClasses.forEach(cls => document.body.classList.remove(cls));
          if (theme !== 'dark') {
            document.body.classList.add(theme);
          } else {
            // For dark theme, ensure we have the right styling
            document.body.classList.remove('light', 'blueberry', 'acai', 'emerald');
          }
          localStorage.setItem('vitamin-theme', theme);
          // Set version
          const versionEl = document.getElementById('app-version');
          if (versionEl) versionEl.textContent = 'v' + version;

          // Ensure proper background color
          document.body.style.backgroundColor = theme === 'light' ? '#ffffff' : '#0a0a0a';

          // Apply theme if applyTheme function exists
          if (typeof applyTheme === 'function') {
            applyTheme(theme);
          }
        } catch (err) {
          console.error('Failed to apply theme on go-home:', err);
        }
      `);
    });
  }
});

// Tab handlers
ipcMain.on('create-tab', () => {
  createTab();
});

ipcMain.on('close-tab', (event, tabId) => {
  closeTab(tabId);
});

ipcMain.on('switch-tab', (event, tabId) => {
  switchToTab(tabId);
});

// Duplicate tab
ipcMain.on('duplicate-tab', (event, tabId) => {
  const tab = tabs.find(t => t.id === tabId);
  if (tab) {
    const newTabId = createTab(tab.url);
    // Set the title and favicon once the page loads
    const newView = tabViews.get(newTabId);
    if (newView) {
      newView.webContents.once('did-finish-load', () => {
        const title = newView.webContents.getTitle();
        const foundTab = tabs.find(t => t.id === newTabId);
        if (foundTab) {
          foundTab.title = title || 'New Tab';
          // Copy favicon from original tab if available
          if (tab.favicon) {
            foundTab.favicon = tab.favicon;
          }
          sendTabsUpdate();
        }
      });
    }
  }
});

// Close other tabs
ipcMain.on('close-other-tabs', (event, tabId) => {
  // Close all tabs except the specified one
  const tabsToClose = tabs.filter(t => t.id !== tabId);
  tabsToClose.forEach(t => closeTab(t.id));
});

// Close tabs to the right
ipcMain.on('close-tabs-to-right', (event, tabId) => {
  // Find the index of the specified tab
  const tabIndex = tabs.findIndex(t => t.id === tabId);
  if (tabIndex !== -1) {
    // Close all tabs to the right of this tab
    const tabsToClose = tabs.slice(tabIndex + 1);
    tabsToClose.forEach(t => closeTab(t.id));
  }
});

// Settings panel - shrink browser view to make room
ipcMain.on('settings-open', () => {
  rightPanelOpen = true;
  leftPanelOpen = false;
  updateActiveTabBounds();
});

ipcMain.on('settings-close', () => {
  rightPanelOpen = false;
  updateActiveTabBounds();
});

// Left panels - need to shrink BrowserView from the left side
ipcMain.on('left-panel-open', () => {
  leftPanelOpen = true;
  rightPanelOpen = false;
  updateActiveTabBounds();
});

ipcMain.on('left-panel-close', () => {
  leftPanelOpen = false;
  updateActiveTabBounds();
});

// Dashboard (poison stats) - show/hide
ipcMain.on('dashboard-show', () => {
  dashboardVisible = true;
  updateActiveTabBounds();
});

ipcMain.on('dashboard-hide', () => {
  dashboardVisible = false;
  updateActiveTabBounds();
});

// Hide BrowserView for modals (What's New, etc.)
ipcMain.on('modal-open', () => {
  if (!mainWindow || !activeTabId) return;
  const view = tabViews.get(activeTabId);
  if (view) {
    mainWindow.removeBrowserView(view);
  }
});

ipcMain.on('modal-close', () => {
  if (!mainWindow || !activeTabId) return;
  const view = tabViews.get(activeTabId);
  if (view && !view.webContents.isDestroyed()) {
    mainWindow.setBrowserView(view);
    updateActiveTabBounds();
  }
});

// Poisoning engine
let poisonInterval = null;
let isPoisoning = false;
let poisonLog = [];

async function doPoison() {
  if (!isPoisoning) return;

  // Get data based on current persona
  let searchTerms, websites;

  // Check if using a custom persona
  if (settings.persona && settings.persona.startsWith('custom_')) {
    const customId = settings.persona.replace('custom_', '');
    const customPersona = customPersonas.find(p => p.id === customId);
    if (customPersona && customPersona.searches && customPersona.sites) {
      searchTerms = customPersona.searches;
      websites = customPersona.sites;
    } else {
      // Fallback to generic
      searchTerms = getSearchTerms(null);
      websites = getSites(null);
    }
  } else {
    searchTerms = getSearchTerms(settings.persona);
    websites = getSites(settings.persona);
  }

  const action = Math.random() > 0.5 ? 'search' : 'visit';
  let activity = {};

  const freqLabel = settings.persona
    ? `${settings.frequency.toUpperCase()}:${settings.persona}`
    : settings.frequency.toUpperCase();

  if (action === 'search') {
    const term = searchTerms[Math.floor(Math.random() * searchTerms.length)];
    const searchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(term)}`;
    activity = { type: 'search', query: term, time: new Date().toLocaleTimeString() };

    // Create hidden view for the search
    const poisonView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        enableRemoteModule: false,
        spellcheck: false,
        session: session.defaultSession
      },
      backgroundColor: '#0a0a0a'
    });

    registerFingerprintProtection(poisonView.webContents);

    // Log when page actually loads (proof it's real)
    poisonView.webContents.on('did-finish-load', () => {
      console.log(`[POISON ${freqLabel}] Loaded search: "${term}"`);
    });

    poisonView.webContents.loadURL(searchUrl);
    poisonViews.push(poisonView);

    // Clean up after a bit
    setTimeout(() => {
      const idx = poisonViews.indexOf(poisonView);
      if (idx > -1) {
        poisonView.webContents.destroy();
        poisonViews.splice(idx, 1);
      }
    }, 8000);

  } else {
    const site = websites[Math.floor(Math.random() * websites.length)];
    activity = { type: 'visit', url: site, time: new Date().toLocaleTimeString() };

    const poisonView = new BrowserView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        enableRemoteModule: false,
        spellcheck: false,
        session: session.defaultSession
      },
      backgroundColor: '#0a0a0a'
    });

    registerFingerprintProtection(poisonView.webContents);

    // Log when page actually loads (proof it's real)
    poisonView.webContents.on('did-finish-load', () => {
      console.log(`[POISON ${freqLabel}] Loaded site: ${site}`);
    });

    poisonView.webContents.loadURL(site);
    poisonViews.push(poisonView);

    setTimeout(() => {
      const idx = poisonViews.indexOf(poisonView);
      if (idx > -1) {
        poisonView.webContents.destroy();
        poisonViews.splice(idx, 1);
      }
    }, 12000);
  }

  // Log the activity
  poisonLog.unshift(activity);
  if (poisonLog.length > 50) poisonLog.pop();

  // Send to renderer
  if (mainWindow) {
    mainWindow.webContents.send('poison-activity', activity);
    mainWindow.webContents.send('poison-stats', {
      totalActions: poisonLog.length,
      searches: poisonLog.filter(a => a.type === 'search').length,
      visits: poisonLog.filter(a => a.type === 'visit').length
    });
  }

  // Schedule next poison action with delay based on frequency
  if (isPoisoning) {
    poisonInterval = setTimeout(doPoison, getDelay(settings.frequency));
  }
}

ipcMain.on('toggle-poison', (event, enabled) => {
  isPoisoning = enabled;

  if (enabled) {
    console.log('Poisoning enabled');
    doPoison(); // Start immediately
  } else {
    console.log('Poisoning disabled');
    if (poisonInterval) {
      clearTimeout(poisonInterval);
      poisonInterval = null;
    }
    // Clean up poison views
    poisonViews.forEach(v => v.webContents.destroy());
    poisonViews = [];
  }

  // Broadcast poison state to all BrowserViews (for start page VITA effect)
  for (const [tabId, view] of tabViews) {
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('poison-state', enabled);
    }
  }
});

ipcMain.handle('get-poison-log', () => {
  return poisonLog;
});

// Settings handlers
ipcMain.on('set-frequency', (event, frequency) => {
  if (frequencies[frequency]) {
    settings.frequency = frequency;
    saveSettings();
    console.log(`Frequency set to ${frequency}`);
  }
});

// Set persona handler
ipcMain.on('set-persona', (event, persona) => {
  console.log(`[PERSONA] Switching persona from ${settings.persona} to ${persona}`);
  settings.persona = persona;
  saveSettings();
  console.log(`[PERSONA] Persona set to ${persona}`);
});

// Get frequency options for UI
ipcMain.handle('get-frequencies', () => {
  return getFrequencyList();
});

// Open external URL in default browser
ipcMain.on('open-external', (event, url) => {
  if (denyIfUntrusted(event, 'open-external')) return;
  if (!isSafeExternalUrl(url)) {
    console.warn(`[SECURITY] Blocked open-external for invalid URL: ${url}`);
    return;
  }
  shell.openExternal(url);
});

ipcMain.on('set-theme', (event, theme) => {
  if (denyIfUntrusted(event, 'set-theme')) return;
  // Update settings and save immediately
  settings.theme = normalizeTheme(theme);
  saveSettings();

  // Set native theme so websites respect light/dark preference
  // Only 'light' (Creamsicle) is light mode, all others are dark
  nativeTheme.themeSource = (settings.theme === 'light') ? 'light' : 'dark';

  // Apply theme to all open windows
  BrowserWindow.getAllWindows().forEach(window => {
    window.setBackgroundColor(settings.theme === 'dark' ? '#0d0d0d' : '#ffffff');
    window.webContents.send('theme-change', settings.theme);
  });

  // Apply theme to all BrowserViews
  applyThemeToAllViews(settings.theme);
});

// Apply theme to all BrowserViews
function applyThemeToAllViews(theme) {
  setTimeout(() => {
    for (const [tabId, view] of tabViews) {
      if (view && view.webContents && !view.webContents.isDestroyed()) {
        // Get current URL to check if it's an internal page
        const currentUrl = view.webContents.getURL();
        const isInternalPage = currentUrl.startsWith('file://') || currentUrl === '';

        // Only set background color for internal pages
        if (isInternalPage) {
          view.setBackgroundColor('#0a0a0a');
        }

        // Send theme change message
        view.webContents.send('theme-change', theme);

        // Only apply theme styles to internal pages - don't touch external websites
        if (isInternalPage) {
          view.webContents.executeJavaScript(getThemeInjectionScript(theme));
        }
      }
    }

    // Poison views are hidden background tabs - no need for theme changes
  }, 100);
}

ipcMain.handle('get-personas', () => {
  const builtInPersonas = getPersonaList();
  // Add custom personas
  const customList = customPersonas.map(p => ({
    id: `custom_${p.id}`,
    name: p.name,
    description: p.description || 'Custom persona',
    isCustom: true
  }));
  // Combine and filter duplicates
  const allPersonas = [...builtInPersonas, ...customList];
  const uniquePersonas = allPersonas.filter((persona, index, self) =>
    index === self.findIndex(p => p.id === persona.id)
  );
  return uniquePersonas;
});

// Custom persona CRUD
ipcMain.handle('get-custom-personas', () => {
  return customPersonas;
});

ipcMain.handle('save-custom-persona', (event, persona) => {
  // Validate
  if (!persona.name || !persona.searches || !persona.sites) {
    return { success: false, error: 'Oopsie! Plz fill in da name, searches, and sites to make dis persona work uwu' };
  }

  // Generate ID if new
  if (!persona.id) {
    persona.id = Date.now().toString();
  }

  // Check if updating existing
  const existingIndex = customPersonas.findIndex(p => p.id === persona.id);
  if (existingIndex >= 0) {
    customPersonas[existingIndex] = persona;
  } else {
    customPersonas.push(persona);
  }

  saveCustomPersonas();
  return { success: true, persona };
});

ipcMain.handle('delete-custom-persona', (event, personaId) => {
  const index = customPersonas.findIndex(p => p.id === personaId);
  if (index >= 0) {
    customPersonas.splice(index, 1);
    saveCustomPersonas();
    return { success: true };
  }
  return { success: false, error: 'Hmm, I can\'t find dat persona. Maybe it got lost? sowwy (╥﹏╥)' };
});

ipcMain.handle('get-custom-persona-data', (event, personaId) => {
  // Strip 'custom_' prefix if present
  const id = personaId.replace('custom_', '');
  const persona = customPersonas.find(p => p.id === id);
  return persona || null;
});

ipcMain.on('toggle-auto-update', (event, enabled) => {
  settings.autoUpdate = enabled;
  saveSettings();
  console.log(`Auto-update set to ${enabled}`);
});

ipcMain.handle('get-settings', (event) => {
  if (denyIfUntrusted(event, 'get-settings')) return null;
  return settings;
});

ipcMain.handle('get-fingerprint-setting', () => {
  return settings.blockFingerprinting;
});

ipcMain.on('get-fingerprint-setting-sync', (event) => {
  event.returnValue = settings.blockFingerprinting;
});

ipcMain.on('get-privacy-settings-sync', (event) => {
  event.returnValue = {
    blockFingerprinting: settings.blockFingerprinting,
    blockfingerprint: settings.blockfingerprint
  };
});

// Get current poison state
ipcMain.handle('get-poison-state', (event) => {
  if (denyIfUntrusted(event, 'get-poison-state')) return false;
  return isPoisoning;
});

// Get performance metrics
ipcMain.handle('get-performance-metrics', (event) => {
  if (denyIfUntrusted(event, 'get-performance-metrics')) return null;
  return getPerformanceMetrics();
});

// Restore session toggle
ipcMain.on('toggle-restore-session', (event, enabled) => {
  settings.restoreSession = enabled;
  saveSettings();
});

ipcMain.on('toggle-popups', (event, enabled) => {
  settings.blockPopups = enabled;
  saveSettings();
});

ipcMain.on('toggle-aggressive-adblock', (event, enabled) => {
  settings.aggressiveAdBlock = enabled;
  saveSettings();
  adblockModule.reinitialize().catch(err => {
    console.error('Failed to reinitialize ad blocker:', err.message);
  });
});

ipcMain.on('toggle-fingerprint-tests', (event, enabled) => {
  settings.blockfingerprint = enabled;
  saveSettings();
});

// Performance mode toggle
ipcMain.on('toggle-performance-mode', (event, enabled) => {
  settings.performanceMode = enabled;
  saveSettings();

  // Send performance mode state to all windows
  BrowserWindow.getAllWindows().forEach(window => {
    window.webContents.send('performance-mode-change', enabled);
  });

  // Send performance mode state to all BrowserViews (for start page)
  for (const [tabId, view] of tabViews) {
    if (view && view.webContents && !view.webContents.isDestroyed()) {
      view.webContents.send('performance-mode-change', enabled);
    }
  }

  // Apply performance mode to all views
  applyPerformanceModeToAllViews(enabled);
});

// Apply performance mode to a view
function applyPerformanceModeToView(view, enabled) {
  if (view && view.webContents && !view.webContents.isDestroyed()) {
    if (enabled) {
      // Enable performance optimizations
      view.webContents.setBackgroundThrottling(true);
      view.webContents.executeJavaScript(`
        // Disable animations and transitions
        if (document.head) {
          const style = document.createElement('style');
          style.textContent = '* { animation-duration: 0s !important; transition-duration: 0s !important; }';
          style.id = 'vitamin-performance-mode';
          document.head.appendChild(style);
        }
      `).catch(() => {});
    } else {
      // Disable performance optimizations
      view.webContents.setBackgroundThrottling(false);
      view.webContents.executeJavaScript(`
        // Remove performance mode styles
        const perfStyle = document.getElementById('vitamin-performance-mode');
        if (perfStyle) perfStyle.remove();
      `).catch(() => {});
    }
  }
}

// Apply performance mode to all views
function applyPerformanceModeToAllViews(enabled) {
  for (const [tabId, view] of tabViews) {
    applyPerformanceModeToView(view, enabled);
  }
}

// Run bookmarklet (execute JavaScript in page context)
ipcMain.handle('run-bookmarklet', async (event, jsCode) => {
  if (denyIfUntrusted(event, 'run-bookmarklet')) {
    return { success: false, error: 'Untrusted sender' };
  }
  const view = getActiveView();
  if (view) {
    try {
      if (typeof jsCode !== 'string' || jsCode.trim() === '') {
        return { success: false, error: 'Invalid bookmarklet' };
      }
      const currentUrl = view.webContents.getURL();
      if (!isSafeExternalUrl(currentUrl)) {
        return { success: false, error: 'Bookmarklets only work on http(s) pages' };
      }
      await view.webContents.executeJavaScript(jsCode);
      return { success: true };
    } catch (err) {
      console.error('Bookmarklet error:', err);
      return { success: false, error: `Oopsie woopsie! Dat bookmarklet haz a boo boo: ${err.message} sowwy ~(˘▾˘~)` };
    }
  }
  return { success: false, error: 'No active tab open. Plz open a tab 1st sowwy (˘･_･˘)' };
});

// ===== Cookies =====
ipcMain.handle('get-cookies', async (event) => {
  if (denyIfUntrusted(event, 'get-cookies')) return [];
  try {
    const cookies = await session.defaultSession.cookies.get({});
    return cookies;
  } catch (err) {
    console.error('Failed to get cookies:', err);
    return [];
  }
});

ipcMain.handle('shred-cookies', async (event) => {
  if (denyIfUntrusted(event, 'shred-cookies')) return false;
  try {
    await session.defaultSession.clearStorageData({
      storages: ['cookies']
    });
    return true;
  } catch (err) {
    console.error('Failed to shred cookies:', err);
    return false;
  }
});

// ===== Downloads =====
ipcMain.handle('get-downloads', (event) => {
  if (denyIfUntrusted(event, 'get-downloads')) return [];
  return downloads;
});

ipcMain.handle('open-download', (event, savePath) => {
  if (denyIfUntrusted(event, 'open-download')) return false;
  if (!isKnownDownloadPath(savePath)) {
    console.warn(`[SECURITY] Blocked open-download for unknown path: ${savePath}`);
    return false;
  }
  return shell.openPath(savePath);
});

ipcMain.handle('show-download-in-folder', (event, savePath) => {
  if (denyIfUntrusted(event, 'show-download-in-folder')) return false;
  if (!isKnownDownloadPath(savePath)) {
    console.warn(`[SECURITY] Blocked show-download-in-folder for unknown path: ${savePath}`);
    return false;
  }
  shell.showItemInFolder(savePath);
  return true;
});

ipcMain.handle('clear-downloads', (event) => {
  if (denyIfUntrusted(event, 'clear-downloads')) return downloads;
  downloads = downloads.filter(d => d.state === 'progressing');
  return downloads;
});

// ===== Find in Page =====
ipcMain.on('find-in-page', (event, text, options) => {
  const view = getActiveView();
  if (view && text) {
    view.webContents.findInPage(text, options);
  }
});

ipcMain.on('find-next', () => {
  const view = getActiveView();
  if (view) {
    view.webContents.findInPage('', { findNext: true });
  }
});

ipcMain.on('find-previous', () => {
  const view = getActiveView();
  if (view) {
    view.webContents.findInPage('', { findNext: true, forward: false });
  }
});

ipcMain.on('stop-find', () => {
  const view = getActiveView();
  if (view) {
    view.webContents.stopFindInPage('clearSelection');
  }
});

// ===== Changelog =====
ipcMain.handle('get-changelog', async (event) => {
  if (denyIfUntrusted(event, 'get-changelog')) return {};
  // Fetch fresh if cache is empty
  if (Object.keys(releaseNotesCache).length === 0) {
    await fetchReleaseNotes();
  }
  return getReleaseNotes();
});

// Get app version
ipcMain.handle('get-app-version', (event) => {
  if (denyIfUntrusted(event, 'get-app-version')) return null;
  return app.getVersion();
});

// Get release notes for a version
ipcMain.handle('get-release-notes', async (event, version) => {
  if (denyIfUntrusted(event, 'get-release-notes')) return [];
  if (Object.keys(releaseNotesCache).length === 0) {
    await fetchReleaseNotes();
  }
  return getReleaseNotesForVersion(version);
});

// Mark version as seen (dismiss "What's New")
ipcMain.on('mark-version-seen', () => {
  settings.lastSeenVersion = app.getVersion();
  saveSettings();
});

// Complete onboarding (first-time setup)
ipcMain.on('complete-onboarding', (event) => {
  if (denyIfUntrusted(event, 'complete-onboarding')) return;
  settings.onboardingComplete = true;
  saveSettings();
  // Notify any listeners that onboarding is complete
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('onboarding-completed');
  }
  // Close the onboarding window
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.destroy();
    onboardingWindow = null;
  }
});

// Show onboarding window (for replay button)
ipcMain.on('show-onboarding', () => {
  // Reset onboarding completion status when replaying
  settings.onboardingComplete = false;
  saveSettings();
  showOnboardingWindow();
});

// Get platform
ipcMain.handle('get-platform', () => {
  return process.platform;
});

// Window controls (for Linux frameless)
ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
  if (mainWindow) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

// Auto-update handlers
ipcMain.handle('install-update', (event) => {
  if (denyIfUntrusted(event, 'install-update')) return null;
  if (autoUpdater) {
    autoUpdater.quitAndInstall();
  }
});

ipcMain.handle('check-for-updates', async (event) => {
  if (denyIfUntrusted(event, 'check-for-updates')) {
    return { success: false, error: 'Untrusted sender' };
  }
  if (autoUpdater && !isDev) {
    try {
      await autoUpdater.checkForUpdates();
      return { success: true };
    } catch (err) {
      console.error('Manual update check failed:', err);
      return { success: false, error: `Update check haz a boo boo: ${err.message}. sowwy (ಥ﹏ಥ)` };
    }
  }
  return { success: false, error: 'Updates r not available in dev mode. Try building me 1st sowwy ~(˘▾˘~)' };
});

app.whenReady().then(async () => {
  // Load settings before creating window
  loadSettings();

  // Set native theme so websites respect light/dark preference on startup
  nativeTheme.themeSource = (settings.theme === 'light') ? 'light' : 'dark';

  registerFingerprintPreloadScript();

  // Initialize favicon cache
  initFaviconCache();

  historyModule.load();
  historyModule.registerIPC();
  bookmarksModule.load();
  bookmarksModule.registerIPC();
  adblockModule.configure({
    getSettings: () => settings,
    getMainWindow: () => mainWindow
  });
  adblockModule.registerIPC(saveSettings);
  adblockModule.init().catch(err => {
    console.error('Failed to initialize ad blocker:', err.message);
  });
  loadCustomPersonas();

  // Apply privacy settings
  applyPrivacySettings();

  // Apply performance mode if enabled
  if (settings.performanceMode) {
    applyPerformanceModeToAllViews(true);
  }

  // Set up download handling
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const download = {
      id: Date.now().toString(),
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: '',
      totalBytes: item.getTotalBytes(),
      receivedBytes: 0,
      state: 'progressing',
      startTime: Date.now()
    };
    downloads.push(download);

    item.on('updated', (event, state) => {
      download.receivedBytes = item.getReceivedBytes();
      download.state = state;
      download.savePath = item.getSavePath();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-updated', download);
      }
    });

    item.once('done', (event, state) => {
      download.state = state;
      download.savePath = item.getSavePath();
      download.receivedBytes = item.getReceivedBytes();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-done', download);
      }
    });
  });

  // Set dock icon on macOS (use icns for better quality)
  if (process.platform === 'darwin') {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/icon.icns'));
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon);
    }
  }

  createWindow();

  // Check for onboarding or "What's New" after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    const currentVersion = app.getVersion();

    // First-time users: show onboarding
    if (!settings.onboardingComplete) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          showOnboardingWindow();
        }
      }, 500);
      return; // Don't show What's New during onboarding
    }

    // Returning users: show What's New if version changed
    if (settings.lastSeenVersion !== currentVersion) {
      // Fetch release notes from GitHub and show if available
      fetchReleaseNotes().then(() => {
        const notes = getReleaseNotesForVersion(currentVersion);
        if (notes && notes.length > 0) {
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('show-whats-new', {
                version: currentVersion,
                notes: notes
              });
            }
          }, 500);
        } else {
          // No release notes for this version, just mark as seen
          settings.lastSeenVersion = currentVersion;
          saveSettings();
        }
      });
    }
  });

  // Set up auto-updater (only in production)
  if (autoUpdater && !isDev) {
    autoUpdater.on('checking-for-update', () => {
      console.log('Checking for updates...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-checking');
      }
    });

    autoUpdater.on('update-available', (info) => {
      console.log('Update available:', info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-available', info.version);
      }
    });

    autoUpdater.on('update-not-available', () => {
      console.log('No updates available');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-not-available');
      }
    });

    autoUpdater.on('download-progress', (progress) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-download-progress', Math.round(progress.percent));
      }
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('Update downloaded:', info.version);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update-downloaded', info.version);
      }
    });

    autoUpdater.on('error', (err) => {
      console.error('Auto-updater error:', err.message);
      if (mainWindow && !mainWindow.isDestroyed()) {
        // On Linux, auto-update for .deb is unreliable - just show up to date
        // Users should check releases manually
        if (process.platform === 'linux') {
          mainWindow.webContents.send('update-not-available');
          return;
        }
        const errMsg = err.message || '';
        // If already on latest version, show up to date
        if (errMsg.includes('No published versions') || errMsg.includes('HttpError: 404')) {
          mainWindow.webContents.send('update-not-available');
          return;
        }
        // Send a user-friendly error message
        let errorMsg = 'Update check haz a boo boo (╥﹏╥)';
        if (errMsg.includes('net::')) {
          errorMsg = 'Network error... I can\'t connect to da interwebs sowwy (ಥ﹏ಥ)';
        } else if (errMsg.includes('ENOTFOUND')) {
          errorMsg = 'No internet... Plz check ur connection sowwy ~(˘▾˘~)';
        } else if (errMsg.includes('code signature')) {
          errorMsg = 'Signature error... Dat update doesn\'t look safe sowwy (ง •̀ω•́)ง';
        }
        mainWindow.webContents.send('update-error', errorMsg);
      }
    });

    // Check for updates after a short delay (if auto-update is enabled)
    setTimeout(() => {
      if (settings.autoUpdate) {
        try {
          autoUpdater.checkForUpdates().catch(err => {
            console.error('Update check failed:', err);
          });
        } catch (err) {
          console.error('Update check error:', err);
        }
      }
    }, 3000);
  }
});

app.on('window-all-closed', () => {
  // Save session before closing (but not if nuke was triggered)
  if (settings.restoreSession && !nukeInProgress) {
    saveSession();
  }

  // Clear browsing data on exit if enabled
  clearBrowsingData();

  // Destroy onboarding window if it exists
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.destroy();
    onboardingWindow = null;
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Flag to prevent session save after nuke
let nukeInProgress = false;

// Secure 3-pass file shredding (DoD 5220.22-M inspired)
// Pass 1: Overwrite with zeros (0x00)
// Pass 2: Overwrite with ones (0xFF)
// Pass 3: Overwrite with random data
function secureShredFile(filePath) {
  try {
    console.log('[NUKE] Shredding file:', filePath);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      console.log('[NUKE] Not a file:', filePath);
      return false;
    }

    const fileSize = stat.size;
    console.log('[NUKE] File size:', fileSize);
    if (fileSize === 0) {
      fs.unlinkSync(filePath);
      console.log('[NUKE] Deleted empty file:', filePath);
      return true;
    }

    const fd = fs.openSync(filePath, 'r+');
    const chunkSize = Math.min(65536, fileSize); // 64KB chunks
    console.log('[NUKE] Chunk size:', chunkSize);

    // Pass 1: Overwrite with zeros
    const zerosBuffer = Buffer.alloc(chunkSize, 0x00);
    for (let offset = 0; offset < fileSize; offset += chunkSize) {
      const writeSize = Math.min(chunkSize, fileSize - offset);
      fs.writeSync(fd, zerosBuffer, 0, writeSize, offset);
    }
    fs.fsyncSync(fd);
    console.log('[NUKE] Pass 1 complete (zeros)');

    // Pass 2: Overwrite with ones
    const onesBuffer = Buffer.alloc(chunkSize, 0xFF);
    for (let offset = 0; offset < fileSize; offset += chunkSize) {
      const writeSize = Math.min(chunkSize, fileSize - offset);
      fs.writeSync(fd, onesBuffer, 0, writeSize, offset);
    }
    fs.fsyncSync(fd);
    console.log('[NUKE] Pass 2 complete (ones)');

    // Pass 3: Overwrite with random data
    const randomBuffer = Buffer.alloc(chunkSize);
    for (let offset = 0; offset < fileSize; offset += chunkSize) {
      const writeSize = Math.min(chunkSize, fileSize - offset);
      require('crypto').randomFillSync(randomBuffer, 0, writeSize);
      fs.writeSync(fd, randomBuffer, 0, writeSize, offset);
    }
    fs.fsyncSync(fd);
    console.log('[NUKE] Pass 3 complete (random)');

    fs.closeSync(fd);
    fs.unlinkSync(filePath);
    console.log('[NUKE] File shredded and deleted:', filePath);
    return true;
  } catch (e) {
    console.log('[NUKE] Error shredding file:', filePath, e.message);
    // Fallback to simple delete if shredding fails
    try {
      fs.unlinkSync(filePath);
      console.log('[NUKE] Fallback delete successful:', filePath);
    } catch (e2) {
      console.log('[NUKE] Fallback delete failed:', filePath, e2.message);
    }
    return false;
  }
}

// Recursively shred all files in a directory
function secureShredDirectory(dirPath) {
  try {
    console.log('[NUKE] Shredding directory:', dirPath);
    const items = fs.readdirSync(dirPath);
    console.log('[NUKE] Directory items:', items);
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      try {
        const stat = fs.statSync(itemPath);
        if (stat.isDirectory()) {
          secureShredDirectory(itemPath);
        } else {
          secureShredFile(itemPath);
        }
      } catch (e) {
        console.log('[NUKE] Error processing item:', itemPath, e.message);
      }
    }
    // Remove empty directory after shredding contents
    fs.rmdirSync(dirPath);
    console.log('[NUKE] Directory removed:', dirPath);
    return true;
  } catch (e) {
    console.log('[NUKE] Error shredding directory:', dirPath, e.message);
    // Fallback to force delete if shredding fails
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      console.log('[NUKE] Fallback directory delete successful:', dirPath);
    } catch (e2) {
      console.log('[NUKE] Fallback directory delete failed:', dirPath, e2.message);
    }
    return false;
  }
}

// Secure nuke function - 3-pass shreds EVERYTHING
async function nukeEverything() {
  console.log('[NUKE] Starting secure 3-pass data shred...');
  nukeInProgress = true;

  const ses = session.defaultSession;
  const userDataPath = app.getPath('userData');
  const appDataPath = app.getPath('appData');
  if (path.resolve(userDataPath) === path.resolve(appDataPath)) {
    throw new Error('Refusing to shred appData root');
  }
  console.log('[NUKE] userData path:', userDataPath);

  // 1. Clear ALL in-memory data
  historyModule.shred();
  // bookmarks will be shredded with the file
  downloads = [];
  tabs.length = 0;
  customPersonas = [];
  console.log('[NUKE] Cleared all in-memory data');

  // 2. Clear ALL Electron session data
  try {
    await ses.clearStorageData();
    console.log('[NUKE] Cleared all storage data');
  } catch (e) {
    console.log('[NUKE] clearStorageData error:', e.message);
  }

  try {
    await ses.clearCache();
    console.log('[NUKE] Cleared cache');
  } catch (e) {
    console.log('[NUKE] clearCache error:', e.message);
  }

  try {
    await ses.clearAuthCache();
    console.log('[NUKE] Cleared auth cache');
  } catch (e) {
    console.log('[NUKE] clearAuthCache error:', e.message);
  }

  try {
    await ses.clearHostResolverCache();
    console.log('[NUKE] Cleared DNS cache');
  } catch (e) {
    console.log('[NUKE] clearHostResolverCache error:', e.message);
  }

  // 3. Secure 3-pass shred ALL files in userData directory
  console.log('[NUKE] Starting 3-pass secure shred of userData...');
  try {
    const files = fs.readdirSync(userDataPath);
    console.log('[NUKE] Files to shred:', files);
    for (const file of files) {
      const filePath = path.join(userDataPath, file);
      try {
        const stat = fs.statSync(filePath);
        console.log('[NUKE] Processing:', file, 'isDirectory:', stat.isDirectory());
        if (stat.isDirectory()) {
          secureShredDirectory(filePath);
          console.log('[NUKE] Shredded directory:', file);
        } else {
          secureShredFile(filePath);
          console.log('[NUKE] Shredded file:', file);
        }
      } catch (e) {
        console.log('[NUKE] Could not shred:', file, e.message);
      }
    }
  } catch (e) {
    console.log('[NUKE] Error reading userData:', e.message);
  }

  // 4. Secure shred temp files
  console.log('[NUKE] Shredding temp files...');
  try {
    const tempPath = app.getPath('temp');
    console.log('[NUKE] temp path:', tempPath);
    const tempFiles = fs.readdirSync(tempPath).filter(f =>
      f.toLowerCase().includes('vitamin') ||
      f.toLowerCase().includes('electron') ||
      f.startsWith('scoped_dir')
    );
    console.log('[NUKE] Temp files to shred:', tempFiles);
    for (const file of tempFiles) {
      try {
        const filePath = path.join(tempPath, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
          secureShredDirectory(filePath);
        } else {
          secureShredFile(filePath);
        }
        console.log('[NUKE] Shredded temp:', file);
      } catch (e) {
        console.log('[NUKE] Could not shred temp file:', file, e.message);
      }
    }
  } catch (e) {
    console.log('[NUKE] Error reading/shredding temp files:', e.message);
  }

  console.log('[NUKE] Complete - all data securely shredded (3-pass)');
  return true;
}

// IPC handler for nuke
ipcMain.handle('nuke-browser-data', async (event) => {
  if (denyIfUntrusted(event, 'nuke-browser-data')) {
    return { success: false, error: 'Untrusted sender' };
  }
  try {
    console.log('[NUKE] IPC handler called');
    const result = await nukeEverything();
    console.log('[NUKE] nukeEverything result:', result);
    return { success: true, result };
  } catch (error) {
    console.error('[NUKE] Failed:', error);
    return { success: false, error: error.message, stack: error.stack };
  }
});

// IPC handler for closing the browser
ipcMain.handle('close-browser', async (event) => {
  if (denyIfUntrusted(event, 'close-browser')) {
    return { success: false, error: 'Untrusted sender' };
  }
  try {
    // DON'T save anything if nuke was triggered - we just deleted everything!
    if (!nukeInProgress) {
      if (typeof saveSettings === 'function') {
        saveSettings();
      }
    }

    // Close all windows
    const windows = BrowserWindow.getAllWindows();
    windows.forEach(win => {
      win.destroy();
    });

    // Quit the app
    app.quit();

    return { success: true };
  } catch (error) {
    console.error('Failed to close browser:', error);
    return { success: false, error: error.message };
  }
});

// Save session when main window is about to close
app.on('before-quit', () => {
  // Don't save session if nuke was triggered
  if (settings.restoreSession && !nukeInProgress) {
    saveSession();
  }

  // Destroy onboarding window if it exists
  if (onboardingWindow && !onboardingWindow.isDestroyed()) {
    onboardingWindow.destroy();
    onboardingWindow = null;
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
