'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, clipboard, ipcMain, Menu, net, protocol, session } = require('electron');

// The renderer is served from a custom, privileged "app://" scheme instead of file://.
// This gives the page a real secure origin (needed by getUserMedia & co.), lets ES modules
// load without file:// CORS quirks, and lets us check that permission requests come from us.
const APP_SCHEME = 'app';
const APP_HOST = 'cryptchat';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');

// Permissions the renderer may ask for. Everything else is denied.
const ALLOWED_PERMISSIONS = new Set(['media']);

const MAX_CLIPBOARD_CHARS = 64 * 1024;

// Dev helper: `npm run start:b` launches a second, independent instance (own userData) so two
// copies can connect to each other on one PC.
const PROFILE = /^--profile=([a-z0-9]+)$/i.exec(process.argv.find((arg) => arg.startsWith('--profile=')) ?? '')?.[1];
if (PROFILE) {
  app.setPath('userData', `${app.getPath('userData')}-${PROFILE}`);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) {
      return new Response('Not found', { status: 404 });
    }

    // Resolve inside RENDERER_ROOT only; reject any path traversal attempt.
    const relative = decodeURIComponent(url.pathname);
    const filePath = path.normalize(path.join(RENDERER_ROOT, relative));
    if (filePath !== RENDERER_ROOT && !filePath.startsWith(RENDERER_ROOT + path.sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
  });
}

// Compares scheme + host explicitly: for non-special schemes like app://, WHATWG URL.origin is "null".
function isOwnOrigin(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === `${APP_SCHEME}:` && parsed.host === APP_HOST;
  } catch {
    return false;
  }
}

function hardenSession() {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isOwnOrigin(details.requestingUrl));
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isOwnOrigin(requestingOrigin);
  });
}

function registerIpc() {
  // Done here rather than with navigator.clipboard: the payload is ready seconds after the
  // click, when the page's user-activation window may already have expired.
  ipcMain.handle('clipboard:write', (event, text) => {
    if (!isOwnOrigin(event.senderFrame?.url)) return false;
    if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_CHARS) return false;
    clipboard.writeText(text);
    return true;
  });
}

// Applies to every webContents we ever create: no navigation away, no new windows.
app.on('web-contents-created', (event, contents) => {
  contents.on('will-navigate', (navEvent, url) => {
    if (!isOwnOrigin(url)) navEvent.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
});

function createMainWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 600,
    backgroundColor: '#000000',
    title: PROFILE ? `CryptChat [${PROFILE}]` : 'CryptChat',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // No application menu; in development F12 still toggles DevTools.
  if (!app.isPackaged) {
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'F12') {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });
  }

  win.loadURL(`${APP_ORIGIN}/index.html`);
  return win;
}

Menu.setApplicationMenu(null);

app.whenReady().then(() => {
  registerAppProtocol();
  hardenSession();
  registerIpc();
  createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
