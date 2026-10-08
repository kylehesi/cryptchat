'use strict';

// The only bridge between the page and Electron. Keep this API small and explicit:
// never expose ipcRenderer, require, or anything Node-shaped to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cc', {
  dev: process.argv.includes('--cc-dev'),
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  clipboard: {
    /** @returns {Promise<boolean>} */
    writeText: (text) => ipcRenderer.invoke('clipboard:write', text),
  },
});
