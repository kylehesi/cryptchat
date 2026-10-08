// Screen share: puts a captured screen/window (+ optional system audio) on the pre-made
// 'screen' / 'screenAudio' slots with replaceTrack(): no renegotiation, no dummy track.
// Never touches the DOM.
//
// Events (CustomEvent.detail):
//   'local'   { name, withAudio, preset } | null     what we are broadcasting
//   'remote'  { active, audio, videoTrack }          what the peer is broadcasting

import { log } from '../core/logger.js';

export const PRESETS = {
  detail: { label: 'TEXT/CODE', fps: 30, maxBitrate: 4_000_000, degradation: 'maintain-resolution', hint: 'detail' },
  motion: { label: 'MOTION/GAMES', fps: 60, maxBitrate: 8_000_000, degradation: 'maintain-framerate', hint: 'motion' },
};

const SYSTEM_AUDIO_BITRATE = 128_000;

export class ScreenShare extends EventTarget {
  /** @type {{ name: string, withAudio: boolean, preset: string } | null} */
  local = null;
  remote = { active: false, audio: false, videoTrack: null };

  #session = null;
  #tracks = [];
  #remoteAudio = new Audio();

  /**
   * @param {{ connection: import('../net/connection.js').Connection,
   *           voice: import('./voice.js').Voice }} deps
   */
  constructor({ connection, voice }) {
    super();
    this.connection = connection;
    this.#remoteAudio.autoplay = true;

    connection.addEventListener('phase', ({ detail }) => {
      if (detail.phase === 'connected' && connection.session !== this.#session) this.#attach(connection.session);
      if (detail.phase === 'idle' || detail.phase === 'failed') this.#detach();
    });

    connection.addEventListener('channel-open', ({ detail }) => {
      if (detail.name === 'control') this.#sendState();
    });

    connection.addEventListener('peer-message', ({ detail }) => {
      const { channel, message } = detail;
      if (channel !== 'control' || message.type !== 'share') return;
      if (typeof message.active !== 'boolean' || typeof message.audio !== 'boolean') return;
      this.#setRemote(message.active, message.active && message.audio);
    });

    // Deafen silences the peer's system audio too.
    voice.addEventListener('local-state', ({ detail }) => {
      this.#remoteAudio.muted = detail.deafened;
    });
  }

  listSources() {
    return window.cc.capture.listSources();
  }

  /** Starts (or switches) the broadcast. Throws with a user-facing message on failure. */
  async start({ source, withAudio, preset }) {
    if (!this.#session) throw new Error('No active link.');
    const settings = PRESETS[preset] ?? PRESETS.detail;

    if (!(await window.cc.capture.select(source.id, withAudio))) {
      throw new Error('Source is no longer available. Refresh the list.');
    }

    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: settings.fps, max: settings.fps } },
      audio: withAudio
        ? {
            restrictOwnAudio: true, // never capture our own playback (the peer's voice)
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2,
          }
        : false,
    });

    const video = stream.getVideoTracks()[0];
    const audio = stream.getAudioTracks()[0] ?? null;
    video.contentHint = settings.hint;

    this.#stopTracks(); // switching sources: drop the previous capture
    this.#tracks = [video, audio].filter(Boolean);

    const { screen, screenAudio } = this.#session.slots;
    await screen.sender.replaceTrack(video);
    await tune(screen.sender, { maxBitrate: settings.maxBitrate, maxFramerate: settings.fps }, settings.degradation);
    await screenAudio.sender.replaceTrack(audio);
    if (audio) await tune(screenAudio.sender, { maxBitrate: SYSTEM_AUDIO_BITRATE });

    // The user closed the shared window, or Windows revoked the capture.
    video.addEventListener('ended', () => {
      if (this.#tracks.includes(video)) {
        log.warn('Shared source closed. Broadcast stopped.');
        this.stop({ quiet: true });
      }
    });

    this.local = { name: source.name, withAudio: Boolean(audio), preset };
    this.#emit('local', this.local);
    this.#sendState();
    log.ok(`Broadcasting: ${source.name} [${settings.label}]${audio ? ' + system audio' : ''}`);
  }

  async stop({ quiet = false } = {}) {
    if (!this.local) return;
    this.#stopTracks();
    if (this.#session) {
      await this.#session.slots.screen.sender.replaceTrack(null);
      await this.#session.slots.screenAudio.sender.replaceTrack(null);
    }
    this.local = null;
    this.#emit('local', null);
    this.#sendState();
    if (!quiet) log.info('Broadcast stopped.');
  }

  #attach(session) {
    this.#session = session;
    this.remote.videoTrack = session.slots.screen.receiver.track;
    this.#remoteAudio.srcObject = new MediaStream([session.slots.screenAudio.receiver.track]);
    this.#remoteAudio.play().catch(() => {});
  }

  #detach() {
    if (!this.#session) return;
    this.#stopTracks();
    this.#session = null;
    this.#remoteAudio.srcObject = null;
    if (this.local) {
      this.local = null;
      this.#emit('local', null);
    }
    this.remote.videoTrack = null;
    this.#setRemote(false, false);
  }

  #stopTracks() {
    for (const track of this.#tracks) track.stop();
    this.#tracks = [];
  }

  #sendState() {
    this.connection.send('control', 'share', { active: Boolean(this.local), audio: Boolean(this.local?.withAudio) });
  }

  #setRemote(active, audio) {
    const changed = active !== this.remote.active;
    this.remote.active = active;
    this.remote.audio = audio;
    if (changed) log.info(active ? `Peer started broadcasting${audio ? ' (with system audio)' : ''}.` : 'Peer stopped broadcasting.');
    this.#emit('remote', { ...this.remote });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

async function tune(sender, encoding, degradationPreference) {
  const params = sender.getParameters();
  if (!params.encodings?.length) params.encodings = [{}];
  Object.assign(params.encodings[0], encoding);
  if (degradationPreference) params.degradationPreference = degradationPreference;
  try {
    await sender.setParameters(params);
  } catch (error) {
    log.warn(`Could not apply encoder settings: ${error.message}`);
  }
}
