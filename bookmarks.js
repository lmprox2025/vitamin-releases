const { app, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const bookmarksPath = path.join(app.getPath('userData'), 'bookmarks.json');

let bookmarks = [];

function load() {
  try {
    if (fs.existsSync(bookmarksPath)) {
      bookmarks = JSON.parse(fs.readFileSync(bookmarksPath, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load bookmarks:', err);
    bookmarks = [];
  }
}

function save() {
  try {
    fs.writeFileSync(bookmarksPath, JSON.stringify(bookmarks, null, 2));
  } catch (err) {
    console.error('Failed to save bookmarks:', err);
  }
}

function getAll() {
  return bookmarks;
}

function add(bookmark) {
  const exists = bookmarks.find(b => b.url === bookmark.url);
  if (!exists) {
    bookmarks.unshift({
      id: Date.now().toString(),
      url: bookmark.url,
      title: bookmark.title || bookmark.url,
      favicon: bookmark.favicon || '',
      createdAt: Date.now()
    });
    save();
  }
  return true;
}

function remove(url) {
  bookmarks = bookmarks.filter(b => b.url !== url);
  save();
  return true;
}

function update(oldUrl, newUrl, title) {
  const bookmark = bookmarks.find(b => b.url === oldUrl);
  if (bookmark) {
    bookmark.url = newUrl;
    bookmark.title = title;
    save();
    return true;
  }
  return false;
}

function isBookmarked(url) {
  return bookmarks.some(b => b.url === url);
}

function registerIPC() {
  ipcMain.handle('get-bookmarks', () => getAll());
  ipcMain.handle('add-bookmark', (event, bookmark) => add(bookmark));
  ipcMain.handle('remove-bookmark', (event, url) => remove(url));
  ipcMain.handle('update-bookmark', (event, { oldUrl, newUrl, title }) => update(oldUrl, newUrl, title));
  ipcMain.handle('is-bookmarked', (event, url) => isBookmarked(url));
}

module.exports = { load, save, getAll, add, remove, update, isBookmarked, registerIPC };
