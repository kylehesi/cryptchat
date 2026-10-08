import { Chat } from './chat/chat.js';
import { log } from './core/logger.js';
import { Microphone } from './media/microphone.js';
import { ScreenShare } from './media/screen.js';
import { Voice } from './media/voice.js';
import { VoiceActivity } from './media/voice-activity.js';
import { Connection } from './net/connection.js';
import { NetworkSettings } from './net/network-settings.js';
import { Verification } from './security/verification.js';
import { mountAudioSettings } from './ui/audio-settings.js';
import { mountAvPanel } from './ui/av-panel.js';
import { mountChatPanel } from './ui/chat-panel.js';
import { mountConnectionPanel } from './ui/connection-panel.js';
import { mountLinkStatus } from './ui/link-status.js';
import { mountLogPanel } from './ui/log-panel.js';
import { mountNetworkSettings } from './ui/network-settings-panel.js';
import { mountScreenPanel } from './ui/screen-panel.js';
import { mountVerifyPanel } from './ui/verify-panel.js';
import { mountDialog } from './ui/dialog.js';

const $ = (id) => document.getElementById(id);

mountLogPanel($('kernel-log'));

mountDialog({
  dialog: $('settings-dialog'),
  openButton: $('btn-settings'),
  closeButton: $('btn-settings-close'),
});

mountDialog({
  dialog: $('help-dialog'),
  openButton: $('btn-help'),
  closeButton: $('btn-help-close'),
});

const networkSettings = new NetworkSettings();
const connection = new Connection(networkSettings);
const microphone = new Microphone();
const voice = new Voice({ connection, microphone, activity: new VoiceActivity() });
const screenShare = new ScreenShare({ connection, voice });
const verification = new Verification(connection);

mountConnectionPanel({
  connection,
  localPayload: $('local-payload'),
  remotePayload: $('remote-payload'),
  primaryButton: $('btn-generate'),
  connectButton: $('btn-connect'),
  remoteCard: $('peer-remote'),
});

mountLinkStatus({ connection, element: $('link-status') });

mountVerifyPanel({
  verification,
  els: {
    remoteSection: $('remote-section'),
    verifySection: $('verify-section'),
    code: $('verify-code'),
    okButton: $('btn-verify-ok'),
    badButton: $('btn-verify-bad'),
    tag: $('verify-tag'),
  },
});

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

mountNetworkSettings({
  networkSettings,
  els: {
    stun: $('net-stun'),
    cfKey: $('net-cf-key'),
    cfToken: $('net-cf-token'),
    turnUrls: $('net-turn-urls'),
    turnUser: $('net-turn-user'),
    turnPass: $('net-turn-pass'),
    relayOnly: $('net-relay-only'),
    testButton: $('btn-net-test'),
    defaultsButton: $('btn-net-defaults'),
    saveButton: $('btn-net-save'),
    status: $('net-status'),
  },
});

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
if (window.cc.dev) window.__cc = { connection, microphone, voice, screenShare, networkSettings, verification };

const { electron, chrome } = window.cc.versions;
log.info('--- SYSTEM BOOT ---');
log.info(`Runtime: Electron ${electron} / Chromium ${chrome}`);

networkSettings
  .load()
  .then((config) => {
    const turnParts = [];
    if (config.cloudflare?.keyId) turnParts.push('Cloudflare TURN');
    if (config.turn.urls.length) turnParts.push(`${config.turn.urls.length} custom TURN`);
    const turn = turnParts.length ? turnParts.join(' + ') : 'no TURN';
    log.info(`Network: ${config.stunUrls.length} STUN, ${turn}${config.relayOnly ? ', RELAY_ONLY' : ''}.`);
  })
  .catch((error) => log.err(`Could not load network settings: ${error.message}`));

microphone
  .init()
  .then(() => log.info(`Audio subsystem: ${microphone.devices.length} input device(s) found.`))
  .catch((error) => log.err(`Microphone access failed (${error.name}). Voice will be listen-only.`));
