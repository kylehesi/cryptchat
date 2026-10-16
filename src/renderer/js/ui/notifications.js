// Notifications: which events make which sound, what gets highlighted, and the settings for it.
//
//   chat message, incoming file, file received   → 'message' + highlight the line and chat panel
//   peer terminated / link lost / ICE-DTLS failed → 'disconnect' + highlight peer card, link status, log
//   link up / restored, warnings and errors       → 'console' + highlight the log line and panel
//   our mic/deafen toggles, screen share on/off   → UI 'on' / 'off'
//   any button press                              → UI click (buttons with data-sound="none" play their own)
//
// The taskbar flashes for everything except UI sounds, and only while the window is in the background.

import { log } from '../core/logger.js';

const STORAGE_KEY = 'cc.notify';
const DEFAULTS = { eventsEnabled: true, uiEnabled: true, flashEnabled: true, volume: 0.6 };

export function mountNotifications({ sounds, attention, connection, chat, transfers, voice, screenShare, els }) {
  const { chatPanel, chatLog, logPanel, logList, remoteCard, linkStatus, settings } = els;

  applySettings(loadSettings());

  // --- events → sound + highlight ------------------------------------------------------

  chat.addEventListener('message', ({ detail }) => {
    if (detail.from !== 'remote') return;
    sounds.event('message');
    attention.mark([chatPanel, chatLog.lastElementChild]); // chat-panel appended the line first
  });

  const announced = new Set();
  transfers.addEventListener('change', ({ detail }) => {
    const { transfer } = detail;
    if (transfer.direction !== 'in') return;
    const key = `${transfer.id}:${transfer.status}`;
    if (announced.has(key) || !['offered', 'done'].includes(transfer.status)) return;
    announced.add(key);
    sounds.event('message');
    attention.mark([chatPanel, chatLog.querySelector(`[data-transfer-id="${transfer.id}"]`)]);
  });

  connection.addEventListener('ended', ({ detail }) => {
    if (detail.reason === 'local') return; // we pressed TERMINATE_LINK ourselves
    sounds.event('disconnect');
    attention.mark([remoteCard, linkStatus, logPanel], { tone: 'danger' });
  });

  let previousPhase = connection.phase;
  connection.addEventListener('phase', ({ detail }) => {
    const { phase } = detail;
    if (phase === 'connected' && previousPhase !== 'connected') {
      sounds.event('console'); // link up, or restored after an outage
      attention.mark([logPanel, linkStatus]);
    }
    previousPhase = phase;
  });

  // Warnings and errors from anywhere (log-panel has already appended the line).
  let replaying = true;
  log.subscribe((entry) => {
    if (replaying || !entry.notify || (entry.level !== 'warn' && entry.level !== 'err')) return;
    sounds.event('console');
    attention.mark([logPanel, logList.lastElementChild], { tone: entry.level === 'err' ? 'danger' : 'warn' });
  });
  replaying = false;

  // Our own toggles: rising tone = on, falling = off.
  let lastLocal = { micOn: voice.micOn, deafened: voice.deafened };
  voice.addEventListener('local-state', ({ detail }) => {
    const turnedOn = detail.deafened !== lastLocal.deafened ? !detail.deafened : detail.micOn;
    lastLocal = { ...detail };
    sounds.ui(turnedOn ? 'on' : 'off');
  });

  let sharing = Boolean(screenShare.local);
  screenShare.addEventListener('local', ({ detail }) => {
    if (Boolean(detail) === sharing) return;
    sharing = Boolean(detail);
    sounds.ui(sharing ? 'on' : 'off');
  });
  let peerSharing = screenShare.remote.active;
  screenShare.addEventListener('remote', ({ detail }) => {
    if (detail.active === peerSharing) return;
    peerSharing = detail.active;
    sounds.ui(peerSharing ? 'on' : 'off');
  });

  // Any button press anywhere (settings, help, dialogs, chat...).
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled || button.dataset.sound === 'none') return;
    sounds.ui('click');
  }, { capture: true });

  // --- settings dialog -----------------------------------------------------------------

  for (const input of settings.querySelectorAll('input[type="checkbox"][data-key]')) {
    input.checked = current()[input.dataset.key];
    input.addEventListener('change', () => save({ [input.dataset.key]: input.checked }));
  }

  const { volumeInput, volumeValue } = els;
  const showVolume = (percent) => {
    volumeInput.value = String(percent);
    volumeInput.style.setProperty('--fill', `${percent}%`);
    volumeValue.textContent = `${percent}%`;
  };
  showVolume(Math.round(sounds.volume * 100));
  volumeInput.addEventListener('input', () => {
    showVolume(Number(volumeInput.value));
    sounds.setVolume(Number(volumeInput.value) / 100);
  });
  volumeInput.addEventListener('change', () => {
    save({ volume: Number(volumeInput.value) / 100 });
    sounds.play('message'); // preview at the new level
  });

  for (const button of settings.querySelectorAll('[data-test-sound]')) {
    const [name, variant] = button.dataset.testSound.split(':');
    button.addEventListener('click', () => sounds.play(name, variant));
  }

  // --- persistence -----------------------------------------------------------------------

  function current() {
    return { eventsEnabled: sounds.eventsEnabled, uiEnabled: sounds.uiEnabled, flashEnabled: attention.flashEnabled, volume: sounds.volume };
  }

  function applySettings(value) {
    sounds.eventsEnabled = value.eventsEnabled;
    sounds.uiEnabled = value.uiEnabled;
    sounds.setVolume(value.volume);
    attention.flashEnabled = value.flashEnabled;
  }

  function save(changes) {
    const next = { ...current(), ...changes };
    applySettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // per-device convenience only
    }
  }
}

function loadSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
    const result = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (typeof stored[key] === typeof DEFAULTS[key]) result[key] = stored[key];
    }
    return result;
  } catch {
    return { ...DEFAULTS };
  }
}
