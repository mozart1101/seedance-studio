// Electron main process.
// All network calls to kie.ai go through ipcMain so the renderer never hits
// browser CORS rules, and large uploads/downloads don't pass through the page.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const ALLOWED_HOSTS = new Set([
  'api.kie.ai',
  'kieai.redpandaai.co',
  'tempfile.redpandaai.co',
]);

function assertAllowed(rawUrl) {
  const u = new URL(rawUrl);
  if (u.protocol !== 'https:') throw new Error('Only https URLs are allowed');
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error('Host not allowed: ' + u.hostname);
  return u;
}

// JSON / text requests
ipcMain.handle('http', async (_e, { url, method, headers, body }) => {
  assertAllowed(url);
  const res = await fetch(url, { method, headers, body });
  return { status: res.status, text: await res.text() };
});

// Multipart file upload (File Stream Upload API) for large videos
ipcMain.handle('upload', async (_e, { url, headers, uploadPath, fileName, type, bytes }) => {
  assertAllowed(url);
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from(bytes)], { type: type || 'application/octet-stream' }), fileName);
  fd.append('uploadPath', uploadPath);
  fd.append('fileName', fileName);
  const res = await fetch(url, { method: 'POST', headers, body: fd });
  return { status: res.status, text: await res.text() };
});

// Download a result file to disk via a Save dialog
ipcMain.handle('save-file', async (e, { url, suggestedName, ext }) => {
  assertAllowed(url);
  const res = await fetch(url);
  if (!res.ok) throw new Error('Download failed (HTTP ' + res.status + ')');
  const buf = Buffer.from(await res.arrayBuffer());
  const win = BrowserWindow.fromWebContents(e.sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    defaultPath: suggestedName || 'seedance.mp4',
    filters: [{ name: 'Video', extensions: [ext || 'mp4'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, buf);
  return { saved: true, filePath };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 900,
    backgroundColor: '#0f0f14',
    title: 'Seedance Studio',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
