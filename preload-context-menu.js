const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabMenu', {
  onMenuData: (callback) => ipcRenderer.on('tab-context-menu-data', (event, data) => callback(data)),
  sendAction: (action, data = {}) => ipcRenderer.send('tab-action', { action, ...data }),
  closeMenu: () => ipcRenderer.send('tab-context-menu-close')
});
