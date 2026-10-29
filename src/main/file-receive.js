'use strict';

// Receiving files: the renderer streams chunks here over IPC and we write them straight to disk,
// so file size is never limited by RAM. See ARCHITECTURE §10.
//
// Safety:
// - The peer-supplied name is reduced to a safe Windows file name (no path parts, no reserved
//   names), so a transfer can never write outside Downloads\CryptChat.
// - Data goes to "<name>.part"; only an exact byte count gets renamed to the final name.
// - Finished files get a Mark-of-the-Web (Zone.Identifier = Internet), so Windows SmartScreen
//   and Office treat them like any other download.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { once } = require('node:events');
const { app, ipcMain, shell } = require('electron');

const MAX_ACTIVE = 8;
const FREE_SPACE_MARGIN = 256 * 1024 * 1024; // keep at least this much disk free
const MAX_NAME_CHARS = 150;
const TRANSFER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const UNSAFE_CHARS = /[\u0000-\u001F\u007F<>:"|?*‎‏‪-‮⁦-⁩]/g;
const MARK_OF_THE_WEB = '[ZoneTransfer]\r\nZoneId=3\r\n';

/**
 * A file system error as a short reason without paths. Node's own text contains the full path
 * (with the Windows user name), and receive errors are also sent to the peer as the reason.
 */
function friendlyFsError(error) {
  switch (error?.code) {
    case 'ENOSPC':
      return 'Not enough free disk space.';
    case 'EACCES':
    case 'EPERM':
      return 'Windows denied writing to Downloads\\CryptChat (folder permissions, or an antivirus blocking it).';
    case 'EBUSY':
      return 'The file is locked by another program.';
    case 'ENOENT':
      return 'The Downloads\\CryptChat folder is missing or unreachable.';
    case 'EROFS':
      return 'The Downloads folder is on a read-only drive.';
    default:
      return error?.code ? `Could not write the file (${error.code}).` : String(error?.message ?? error);
  }
}

/** Reduces a peer-supplied name to a plain, harmless Windows file name. */
function safeFileName(raw) {
  let name = String(raw ?? '').split(/[\\/]/).pop();
  name = name.replace(UNSAFE_CHARS, '_').replace(/[. ]+$/, '').trim();
  if (!name || /^\.+$/.test(name)) name = 'file';
  if (RESERVED_NAME.test(name)) name = `_${name}`;
  if (name.length > MAX_NAME_CHARS) {
    const ext = path.extname(name).slice(0, 20);
    name = name.slice(0, MAX_NAME_CHARS - ext.length) + ext;
  }
  return name;
}

/** Atomically reserves "<dir>\<name> (n).part" where neither it nor the final name exists. */
async function reserve(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  for (let n = 0; n < 1000; n++) {
    const finalPath = path.join(dir, n ? `${base} (${n})${ext}` : name);
    if (fs.existsSync(finalPath)) continue;
    try {
      const handle = await fsp.open(`${finalPath}.part`, 'wx'); // fails if it exists: no races
      return { finalPath, partPath: `${finalPath}.part`, stream: handle.createWriteStream() };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('Could not find a free file name.');
}

/** "<name> (n).<ext>" next to `filePath` that does not exist yet. */
function freeName(filePath) {
  const ext = path.extname(filePath);
  const base = filePath.slice(0, filePath.length - ext.length);
  for (let n = 1; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!fs.existsSync(candidate) && !fs.existsSync(`${candidate}.part`)) return candidate;
  }
}

function registerFileReceive({ isOwnOrigin }) {
  const active = new Map(); // id → { stream, partPath, finalPath, expected, written, owner }
  const completed = new Map(); // id → finalPath (for OPEN_FOLDER)
  const watchedOwners = new WeakSet(); // webContents that already have a cleanup listener
  const receiveDir = () => path.join(app.getPath('downloads'), 'CryptChat');

  const abort = (id) => {
    const entry = active.get(id);
    if (!entry) return;
    active.delete(id);
    entry.stream.destroy();
    fs.rm(entry.partPath, { force: true }, () => {});
  };

  const handle = (channel, fn) => {
    ipcMain.handle(channel, async (event, ...args) => {
      if (!isOwnOrigin(event.senderFrame?.url)) return { ok: false, error: 'Forbidden.' };
      try {
        return await fn(event, ...args);
      } catch (error) {
        if (typeof args[0] === 'string') abort(args[0]);
        return { ok: false, error: friendlyFsError(error) };
      }
    });
  };

  handle('file:open', async (event, id, rawName, size) => {
    if (!TRANSFER_ID.test(id ?? '') || active.has(id) || completed.has(id)) throw new Error('Invalid transfer ID.');
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid file size.');
    if (active.size >= MAX_ACTIVE) throw new Error('Too many transfers at once.');

    const dir = receiveDir();
    await fsp.mkdir(dir, { recursive: true });
    const { bavail, bsize } = await fsp.statfs(dir);
    if (bavail * bsize - FREE_SPACE_MARGIN < size) throw new Error('Not enough free disk space.');

    const { finalPath, partPath, stream } = await reserve(dir, safeFileName(rawName));
    const owner = event.sender;
    active.set(id, { stream, partPath, finalPath, expected: size, written: 0, owner, error: null });
    // A write can fail later (disk full, drive gone). Today every write is awaited (drain or
    // close), which catches it; this listener keeps it that way if the flow ever changes, since an
    // unheard 'error' event would be an uncaught main-process exception (an error dialog).
    stream.on('error', (error) => {
      const entry = active.get(id);
      if (entry) entry.error = error;
    });
    // If the window closes or crashes mid-transfer, do not leave .part files behind.
    // One listener per window (not per transfer), so long sessions do not pile them up.
    if (!watchedOwners.has(owner)) {
      watchedOwners.add(owner);
      const abortOwned = () => {
        for (const [transferId, entry] of active) if (entry.owner === owner) abort(transferId);
      };
      owner.once('destroyed', abortOwned);
      owner.on('render-process-gone', abortOwned);
      owner.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) abortOwned(); // reload
      });
    }
    return { ok: true, fileName: path.basename(finalPath), dir };
  });

  handle('file:write', async (event, id, chunk) => {
    const entry = active.get(id);
    if (!entry) throw new Error('Unknown transfer.');
    if (!(chunk instanceof Uint8Array)) throw new Error('Invalid chunk.');
    if (entry.written + chunk.byteLength > entry.expected) throw new Error('Peer sent more data than announced.');
    if (entry.error) throw entry.error; // the stream is gone: a write would wait for 'drain' forever

    entry.written += chunk.byteLength;
    if (!entry.stream.write(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength))) {
      await once(entry.stream, 'drain');
    }
    return { ok: true, written: entry.written };
  });

  handle('file:close', async (event, id) => {
    const entry = active.get(id);
    if (!entry) throw new Error('Unknown transfer.');
    if (entry.written !== entry.expected) throw new Error(`Size mismatch: got ${entry.written} of ${entry.expected} bytes.`);
    if (entry.error) throw entry.error; // already closed by the error: 'close' would never come

    entry.stream.end();
    await once(entry.stream, 'close');
    if (entry.error) throw entry.error; // the last buffered write failed
    active.delete(id);

    // Someone may have created a file with our final name meanwhile; never overwrite it.
    const finalPath = fs.existsSync(entry.finalPath) ? freeName(entry.finalPath) : entry.finalPath;
    await fsp.rename(entry.partPath, finalPath);
    await fsp.writeFile(`${finalPath}:Zone.Identifier`, MARK_OF_THE_WEB).catch(() => {}); // non-NTFS: skip
    completed.set(id, finalPath);
    return { ok: true, fileName: path.basename(finalPath) };
  });

  handle('file:abort', async (event, id) => {
    abort(id);
    return { ok: true };
  });

  handle('file:reveal', async (event, id) => {
    const finalPath = completed.get(id);
    if (!finalPath || !fs.existsSync(finalPath)) throw new Error('File is no longer there.');
    shell.showItemInFolder(finalPath);
    return { ok: true };
  });

  app.on('will-quit', () => {
    for (const id of [...active.keys()]) abort(id);
  });
}

module.exports = { registerFileReceive, safeFileName, friendlyFsError };
