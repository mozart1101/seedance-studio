const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  http: (req) => ipcRenderer.invoke('http', req),
  upload: (req) => ipcRenderer.invoke('upload', req),
  saveFile: (req) => ipcRenderer.invoke('save-file', req),
});
