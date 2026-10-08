import { Chat } from './chat/chat.js';
import { log } from './core/logger.js';
import { Microphone } from './media/microphone.js';
import { ScreenShare } from './media/screen.js';
import { Voice } from './media/voice.js';
import { VoiceActivity } from './media/voice-activity.js';
import { Connection } from './net/connection.js';
import { mountAudioSettings } from './ui/audio-settings.js';
import { mountAvPanel } from './ui/av-panel.js';
import { mountChatPanel } from './ui/chat-panel.js';
import { mountConnectionPanel } from './ui/connection-panel.js';
import { mountLinkStatus } from './ui/link-status.js';
import { mountLogPanel } from './ui/log-panel.js';
import { mountScreenPanel } from './ui/screen-panel.js';
import { mountSettingsModal } from './ui/settings-modal.js';

const $ = (id) => document.getElementById(id);

mountLogPanel($('kernel-log'));

mountSettingsModal({
  dialog: $('settings-dialog'),
  openButton: $('btn-settings'),
  closeButton: $('btn-settings-close'),
});

const connection = new Connection();
const microphone = new Microphone();
const voice = new Voice({ connection, microphone, activity: new VoiceActivity() });
const screenShare = new ScreenShare({ connection, voice });

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

mountAvPanel({
  voice,
  microphone,
  micSelect: $('mic-src'),
  micButton: $('btn-mic'),
  deafenButton: $('btn-deafen'),
  localCard: $('peer-local'),
  remoteCard: $('peer-remote'),
});

mountAudioSettings({ microphone, container: $('audio-settings') });

mountScreenPanel({
  screenShare,
  connection,
  els: {
    shareButton: $('btn-share'),
    dialog: $('source-dialog'),
    grid: $('source-grid'),
    refreshButton: $('btn-source-refresh'),
    audioCheck: $('share-audio'),
    startButton: $('btn-source-start'),
    cancelButton: $('btn-source-cancel'),
    screen: $('screen'),
    video: $('remote-video'),
    placeholder: $('screen-placeholder'),
    badge: $('screen-badge'),
    fullButton: $('btn-fullscreen'),
    pipButton: $('btn-pip'),
  },
});

// Closing the window: let the peer know immediately instead of waiting for an ICE timeout.
window.addEventListener('beforeunload', () => connection.terminate());

// Development only (never in a packaged build): poke at the live objects from DevTools (F12).
if (window.cc.dev) window.__cc = { connection, microphone, voice, screenShare };

const { electron, chrome } = window.cc.versions;
log.info('--- SYSTEM BOOT ---');
log.info(`Runtime: Electron ${electron} / Chromium ${chrome}`);

microphone
  .init()
  .then(() => log.info(`Audio subsystem: ${microphone.devices.length} input device(s) found.`))
  .catch((error) => log.err(`Microphone access failed (${error.name}). Voice will be listen-only.`));
