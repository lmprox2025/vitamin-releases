const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('vitamin', {
  // Navigation
  navigate: (url) => ipcRenderer.send('navigate', url),
  goBack: () => ipcRenderer.send('go-back'),
  goForward: () => ipcRenderer.send('go-forward'),
  refresh: () => ipcRenderer.send('refresh'),
  goHome: () => ipcRenderer.send('go-home'),

  // Theme
  setTheme: (theme) => ipcRenderer.send('set-theme', theme),
  onThemeChange: (callback) => ipcRenderer.on('theme-change', (event, theme) => callback(theme)),

  // Tabs
  createTab: () => ipcRenderer.send('create-tab'),
  closeTab: (tabId) => ipcRenderer.send('close-tab', tabId),
  switchTab: (tabId) => ipcRenderer.send('switch-tab', tabId),
  duplicateTab: (tabId) => ipcRenderer.send('duplicate-tab', tabId),
  closeOtherTabs: (tabId) => ipcRenderer.send('close-other-tabs', tabId),
  closeTabsToRight: (tabId) => ipcRenderer.send('close-tabs-to-right', tabId),

  // Poisoning
  togglePoison: (enabled) => ipcRenderer.send('toggle-poison', enabled),
  getPoisonLog: () => ipcRenderer.invoke('get-poison-log'),
  setFrequency: (frequency) => ipcRenderer.send('set-frequency', frequency),
  getFrequencies: () => ipcRenderer.invoke('get-frequencies'),
  setPersona: (persona) => ipcRenderer.send('set-persona', persona),
  getPersonas: () => ipcRenderer.invoke('get-personas'),

  // Custom personas
  getCustomPersonas: () => ipcRenderer.invoke('get-custom-personas'),
  saveCustomPersona: (persona) => ipcRenderer.invoke('save-custom-persona', persona),
  deleteCustomPersona: (personaId) => ipcRenderer.invoke('delete-custom-persona', personaId),
  getCustomPersonaData: (personaId) => ipcRenderer.invoke('get-custom-persona-data', personaId),

  // Ad blocking
  toggleAdBlock: (enabled) => ipcRenderer.send('toggle-adblock', enabled),
  toggleAggressiveAdBlock: (enabled) => ipcRenderer.send('toggle-aggressive-adblock', enabled),
  togglePopups: (enabled) => ipcRenderer.send('toggle-popups', enabled),
  toggleFingerprintTests: (enabled) => ipcRenderer.send('toggle-fingerprint-tests', enabled),
  toggleAutoUpdate: (enabled) => ipcRenderer.send('toggle-auto-update', enabled),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (bookmark) => ipcRenderer.invoke('add-bookmark', bookmark),
  removeBookmark: (url) => ipcRenderer.invoke('remove-bookmark', url),
  updateBookmark: (data) => ipcRenderer.invoke('update-bookmark', data),
  isBookmarked: (url) => ipcRenderer.invoke('is-bookmarked', url),
  runBookmarklet: (jsCode) => ipcRenderer.invoke('run-bookmarklet', jsCode),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  shredHistory: () => ipcRenderer.invoke('shred-history'),

  // Cookies
  getCookies: () => ipcRenderer.invoke('get-cookies'),
  shredCookies: () => ipcRenderer.invoke('shred-cookies'),

  // Downloads
  getDownloads: () => ipcRenderer.invoke('get-downloads'),
  openDownload: (savePath) => ipcRenderer.invoke('open-download', savePath),
  showDownloadInFolder: (savePath) => ipcRenderer.invoke('show-download-in-folder', savePath),
  clearDownloads: () => ipcRenderer.invoke('clear-downloads'),
  onDownloadUpdated: (callback) => ipcRenderer.on('download-updated', (event, download) => callback(download)),
  onDownloadDone: (callback) => ipcRenderer.on('download-done', (event, download) => callback(download)),

  // Find in page
  findInPage: (text, options) => ipcRenderer.send('find-in-page', text, options),
  findNext: () => ipcRenderer.send('find-next'),
  findPrevious: () => ipcRenderer.send('find-previous'),
  stopFind: () => ipcRenderer.send('stop-find'),
  onFoundInPage: (callback) => ipcRenderer.on('found-in-page', (event, result) => callback(result)),
  onToggleFindBar: (callback) => ipcRenderer.on('toggle-find-bar', () => callback()),

  // Changelog
  getChangelog: () => ipcRenderer.invoke('get-changelog'),

  // Session restore
  toggleRestoreSession: (enabled) => ipcRenderer.send('toggle-restore-session', enabled),

  // Performance mode
  togglePerformanceMode: (enabled) => ipcRenderer.send('toggle-performance-mode', enabled),

  // Settings
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getPerformanceMetrics: () => ipcRenderer.invoke('get-performance-metrics'),
  getPoisonState: () => ipcRenderer.invoke('get-poison-state'),
  onPerformanceModeChange: (callback) => ipcRenderer.on('performance-mode-change', (event, enabled) => callback(enabled)),
  settingsOpen: () => ipcRenderer.send('settings-open'),
  settingsClose: () => ipcRenderer.send('settings-close'),
  leftPanelOpen: () => ipcRenderer.send('left-panel-open'),
  leftPanelClose: () => ipcRenderer.send('left-panel-close'),
  modalOpen: () => ipcRenderer.send('modal-open'),
  modalClose: () => ipcRenderer.send('modal-close'),
  dashboardShow: () => ipcRenderer.send('dashboard-show'),
  dashboardHide: () => ipcRenderer.send('dashboard-hide'),

  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  getPlatform: () => ipcRenderer.invoke('get-platform'),
  getReleaseNotes: (version) => ipcRenderer.invoke('get-release-notes', version),
  markVersionSeen: () => ipcRenderer.send('mark-version-seen'),
  onShowWhatsNew: (callback) => ipcRenderer.on('show-whats-new', (event, data) => callback(data)),

  // Onboarding
  completeOnboarding: () => ipcRenderer.send('complete-onboarding'),
  showOnboarding: () => ipcRenderer.send('show-onboarding'),

  // Window controls (for Linux frameless)
  windowClose: () => ipcRenderer.send('window-close'),
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowMaximize: () => ipcRenderer.send('window-maximize'),

  // Auto-updates
  onUpdateChecking: (callback) => ipcRenderer.on('update-checking', () => callback()),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, version) => callback(version)),
  onUpdateNotAvailable: (callback) => ipcRenderer.on('update-not-available', () => callback()),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (event, percent) => callback(percent)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, version) => callback(version)),
  onUpdateError: (callback) => ipcRenderer.on('update-error', (event, message) => callback(message)),
  installUpdate: () => ipcRenderer.invoke('install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  // Nuke feature
  nukeBrowserData: () => ipcRenderer.invoke('nuke-browser-data'),
  closeBrowser: () => ipcRenderer.invoke('close-browser'),

  // External links
  openExternal: (url) => ipcRenderer.send('open-external', url),

  // Event listeners
  onLoadingStart: (callback) => ipcRenderer.on('loading-start', () => callback()),
  onLoadingStop: (callback) => ipcRenderer.on('loading-stop', () => callback()),
  onUrlChanged: (callback) => ipcRenderer.on('url-changed', (event, url) => callback(url)),
  onTabsUpdate: (callback) => ipcRenderer.on('tabs-update', (event, data) => callback(data)),
  onPoisonActivity: (callback) => ipcRenderer.on('poison-activity', (event, activity) => callback(activity)),
  onPoisonStats: (callback) => ipcRenderer.on('poison-stats', (event, stats) => callback(stats)),
  onBlockedCount: (callback) => ipcRenderer.on('blocked-count', (event, count) => callback(count)),
  onOnboardingCompleted: (callback) => ipcRenderer.on('onboarding-completed', () => callback()),
  onSettingsChanged: (callback) => ipcRenderer.on('settings-changed', () => callback())
});
