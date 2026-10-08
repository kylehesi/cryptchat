'use strict';

// Screen/window capture for the renderer's getDisplayMedia() (ARCHITECTURE §8).
//
// Flow: the renderer lists sources (thumbnails for our own picker), selects one, then calls
// getDisplayMedia(). The display-media handler below answers that call with the selected
// source. A selection is single-use and expires quickly, so getDisplayMedia() can never
// capture anything the user did not just pick.

const { BrowserWindow, desktopCapturer, ipcMain, session } = require('electron');

const SELECTION_TTL_MS = 10000;
const THUMBNAIL_SIZE = { width: 320, height: 180 };

function registerCapture({ isOwnOrigin }) {
  let sources = new Map();
  let pending = null;

  ipcMain.handle('capture:list-sources', async (event) => {
    if (!isOwnOrigin(event.senderFrame?.url)) return [];

    // Sharing our own window is pointless (and would show the feed inside itself).
    const ownIds = new Set(BrowserWindow.getAllWindows().map((win) => win.getMediaSourceId()));
    const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: THUMBNAIL_SIZE });
    sources = new Map(list.filter((source) => !ownIds.has(source.id)).map((source) => [source.id, source]));

    return [...sources.values()].map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith('screen:') ? 'screen' : 'window',
      thumbnail: source.thumbnail.isEmpty() ? null : source.thumbnail.toDataURL(),
    }));
  });

  ipcMain.handle('capture:select', (event, id, withAudio) => {
    if (!isOwnOrigin(event.senderFrame?.url)) return false;
    const source = sources.get(id);
    if (!source) return false;
    pending = { source, withAudio: withAudio === true, expires: Date.now() + SELECTION_TTL_MS };
    return true;
  });

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const selection = pending;
    pending = null;

    if (!selection || selection.expires < Date.now() || !isOwnOrigin(request.frame?.url)) {
      callback({}); // nothing granted → getDisplayMedia() rejects
      return;
    }

    // 'loopback' = Windows system audio. The renderer adds restrictOwnAudio so our own
    // playback (the peer's voice) is excluded and never echoed back to them.
    if (selection.withAudio && request.audioRequested) {
      callback({ video: selection.source, audio: 'loopback' });
    } else {
      callback({ video: selection.source });
    }
  });
}

module.exports = { registerCapture };
