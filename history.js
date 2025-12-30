const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const historyPath = path.join(app.getPath('userData'), 'history.json');

let history = [];
let historySaveTimeout = null;

function load() {
  try {
    if (fs.existsSync(historyPath)) {
      history = JSON.parse(fs.readFileSync(historyPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load history:', err);
    history = [];
  }
}

function save() {
  clearTimeout(historySaveTimeout);
  historySaveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(historyPath, JSON.stringify(history, null, 2));
    } catch (err) {
      console.error('Failed to save history:', err);
    }
  }, 1000);
}

function add(url, title) {
  if (!url || url.startsWith('file://')) return;
  history.unshift({
    url,
    title: title || url,
    timestamp: Date.now()
  });
  if (history.length > 1000) history = history.slice(0, 1000);
  save();
}

function getAll() {
  return history;
}

function shred() {
  history = [];
  try {
    if (fs.existsSync(historyPath)) {
      const stats = fs.statSync(historyPath);
      const size = stats.size;
      if (size > 0) {
        // Overwrite 3 times with random data
        for (let pass = 0; pass < 3; pass++) {
          fs.writeFileSync(historyPath, crypto.randomBytes(size));
        }
        fs.writeFileSync(historyPath, Buffer.alloc(size, 0));
      }
      fs.unlinkSync(historyPath);
    }
  } catch (err) {
    console.error('Failed to shred history:', err);
  }
  return true;
}

function registerIPC() {
  ipcMain.handle('get-history', () => getAll());
  ipcMain.handle('shred-history', () => shred());
}

module.exports = { load, save, add, getAll, shred, registerIPC };
