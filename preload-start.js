const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chrome', {
  ipcRenderer: {
    on: (channel, callback) => ipcRenderer.on(channel, callback),
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
  }
});

contextBridge.exposeInMainWorld('vitamin', {
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});