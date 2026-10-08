import { Chat } from './chat/chat.js';
import { log } from './core/logger.js';
import { Connection } from './net/connection.js';
import { mountChatPanel } from './ui/chat-panel.js';
import { mountConnectionPanel } from './ui/connection-panel.js';
import { mountLinkStatus } from './ui/link-status.js';
import { mountLogPanel } from './ui/log-panel.js';
import { mountSettingsModal } from './ui/settings-modal.js';

const $ = (id) => document.getElementById(id);

mountLogPanel($('kernel-log'));

mountSettingsModal({
  dialog: $('settings-dialog'),
  openButton: $('btn-settings'),
  closeButton: $('btn-settings-close'),
});

const connection = new Connection();

mountConnectionPanel({
  connection,
  localPayload: $('local-payload'),
  remotePayload: $('remote-payload'),
  primaryButton: $('btn-generate'),
  connectButton: $('btn-connect'),
  remoteCard: $('peer-remote'),
});

mountLinkStatus({ connection, element: $('link-status') });

mountChatPanel({
  chat: new Chat(connection),
  aliasInput: $('chat-alias'),
  chatLog: $('chat-log'),
  form: $('chat-form'),
  messageInput: $('chat-input'),
  sendButton: $('btn-send'),
  localName: document.querySelector('#peer-local .peer-name'),
  remoteName: document.querySelector('#peer-remote .peer-name'),
});

// Closing the window: let the peer know immediately instead of waiting for an ICE timeout.
window.addEventListener('beforeunload', () => connection.terminate());

// Development only (never in a packaged build): poke at the live connection from DevTools (F12).
if (window.cc.dev) window.__cc = { connection };

const { electron, chrome } = window.cc.versions;
log.info('--- SYSTEM BOOT ---');
log.info(`Runtime: Electron ${electron} / Chromium ${chrome}`);
