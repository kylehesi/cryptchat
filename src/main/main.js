'use strict';

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, clipboard, ipcMain, Menu, net, protocol, session } = require('electron');
const { registerCapture } = require('./capture');
const { registerSecureStore } = require('./secure-store');
const { registerCloudflareTurn } = require('./cloudflare-turn');
const { registerFileReceive } = require('./file-receive');
const windowState = require('./window-state');

// The renderer is served from a custom, privileged "app://" scheme instead of file://.
// This gives the page a real secure origin (needed by getUserMedia & co.), lets ES modules
// load without file:// CORS quirks, and lets us check that permission requests come from us.
const APP_SCHEME = 'app';
const APP_HOST = 'cryptchat';
const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
const RENDERER_ROOT = path.join(__dirname, '..', 'renderer');
const ICON_PATH = path.join(__dirname, '..', '..', 'build', 'icon.ico');

// Permissions the renderer may ask for. Everything else is denied.
// (Screen capture does not go through this list; see capture.js.)
const ALLOWED_PERMISSIONS = new Set(['media', 'fullscreen']);

const MAX_CLIPBOARD_CHARS = 64 * 1024;

// Dev helper: `npm run start:b` launches a second, independent instance (own userData) so two
// copies can connect to each other on one PC.
const PROFILE = /^--profile=([a-z0-9]+)$/i.exec(process.argv.find((arg) => arg.startsWith('--profile=')) ?? '')?.[1];
if (PROFILE) {
  app.setPath('userData', `${app.getPath('userData')}-${PROFILE}`);
}

// One instance per profile: a second launch (say, a double-clicked shortcut) would share the
// first one's settings and storage. It brings the running window to the front instead. The
// lock belongs to the userData folder, so `--profile=b` still gets an instance of its own.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();

let mainWindow = null;

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
  ipcMain.handle('clipboard:write', async (event, text) => {
    if (!isOwnOrigin(event.senderFrame?.url)) return false;
    if (typeof text !== 'string' || text.length > MAX_CLIPBOARD_CHARS) return false;
    try {
      await clipboard.writeText(text); // returns a promise in current Electron: wait, so "copied" is true
      return true;
    } catch {
      return false;
    }
  });

  // Notifications: flash the taskbar button while the window is in the background.
  const flashing = new WeakSet();
  ipcMain.handle('window:flash', (event) => {
    if (!isOwnOrigin(event.senderFrame?.url)) return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed() || win.isFocused()) return false;
    win.flashFrame(true);
    if (!flashing.has(win)) {
      flashing.add(win);
      win.once('focus', () => {
        flashing.delete(win);
        win.flashFrame(false);
      });
    }
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
  const { maximized, ...bounds } = windowState.windowOptions(); // remembered or default size
  const win = new BrowserWindow({
    ...bounds,
    backgroundColor: '#000000',
    // Installed builds use the icon embedded in CryptChat.exe; build/ is not packaged.
    icon: app.isPackaged ? undefined : ICON_PATH,
    title: PROFILE ? `CryptChat [${PROFILE}]` : 'CryptChat',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      additionalArguments: [`--cc-version=${app.getVersion()}`, ...(app.isPackaged ? [] : ['--cc-dev'])],
    },
  });

  // Never smaller than the compact layout (it would clip); size and position are remembered.
  windowState.track(win, { maximized });
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

// Own taskbar identity, so Windows shows our icon instead of grouping us under electron.exe.
app.setAppUserModelId('org.cryptchat.app');

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  if (!isFirstInstance) return; // quitting: this profile is already open
  registerAppProtocol();
  hardenSession();
  registerIpc();
  registerCapture({ isOwnOrigin });
  registerSecureStore({ isOwnOrigin });
  registerCloudflareTurn({ isOwnOrigin });
  registerFileReceive({ isOwnOrigin });
  mainWindow = createMainWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
