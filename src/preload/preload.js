'use strict';

// The only bridge between the page and Electron. Keep this API small and explicit:
// never expose ipcRenderer, require, or anything Node-shaped to the page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cc', {
  dev: process.argv.includes('--cc-dev'),
  /** App version from package.json (passed in by the main process). */
  version: process.argv.find((arg) => arg.startsWith('--cc-version='))?.slice('--cc-version='.length) ?? '?',
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
  clipboard: {
    /** @returns {Promise<boolean>} */
    writeText: (text) => ipcRenderer.invoke('clipboard:write', text),
  },
  settings: {
    /** @returns {Promise<{ config: object, defaults: object }>} */
    getNetwork: () => ipcRenderer.invoke('settings:get-network'),
    /** Validated and encrypted by the main process. @returns {Promise<{ ok: boolean, config?: object, errors: string[] }>} */
    setNetwork: (config) => ipcRenderer.invoke('settings:set-network', config),
  },
  turn: {
    /** Short-lived Cloudflare TURN credentials. @returns {Promise<{ ok: boolean, iceServers?: RTCIceServer[], error?: string }>} */
    cloudflare: (keyId, apiToken) => ipcRenderer.invoke('turn:cloudflare', keyId, apiToken),
  },
  files: {
    // Receiving side: the main process owns the disk. All return { ok, error? , ... }.
    open: (id, name, size) => ipcRenderer.invoke('file:open', id, name, size),
    write: (id, chunk) => ipcRenderer.invoke('file:write', id, chunk),
    close: (id) => ipcRenderer.invoke('file:close', id),
    abort: (id) => ipcRenderer.invoke('file:abort', id),
    reveal: (id) => ipcRenderer.invoke('file:reveal', id),
  },
  capture: {
    /** @returns {Promise<{ id: string, name: string, kind: 'screen' | 'window', thumbnail: string | null }[]>} */
    listSources: () => ipcRenderer.invoke('capture:list-sources'),
    /** Arms the next getDisplayMedia() call with this source. @returns {Promise<boolean>} */
    select: (id, withAudio) => ipcRenderer.invoke('capture:select', id, withAudio),
  },
});
