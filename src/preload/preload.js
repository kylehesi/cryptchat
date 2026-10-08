'use strict';

// The only bridge between the page and Electron. Keep this API small and explicit:
// never expose ipcRenderer, require, or anything Node-shaped to the page.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('cc', {
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
