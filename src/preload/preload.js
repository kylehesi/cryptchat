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
  capture: {
    /** @returns {Promise<{ id: string, name: string, kind: 'screen' | 'window', thumbnail: string | null }[]>} */
    listSources: () => ipcRenderer.invoke('capture:list-sources'),
    /** Arms the next getDisplayMedia() call with this source. @returns {Promise<boolean>} */
    select: (id, withAudio) => ipcRenderer.invoke('capture:select', id, withAudio),
  },
});
