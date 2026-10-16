// Screen share: puts a captured screen/window (+ optional system audio) on the pre-made
// 'screen' / 'screenAudio' slots with replaceTrack(): no renegotiation, no dummy track.
// Never touches the DOM.
//
// Codec: every codec is negotiated up front (best first, see SCREEN_CODEC_ORDER), and the
// encoder is picked per share with RTCRtpEncodingParameters.codec. In AUTO mode, if the encoder
// is CPU-bound for a few seconds, it steps down AV1 → VP9 → VP8 on the fly.
//
// Events (CustomEvent.detail):
//   'local'         { sourceId, name, withAudio, preset } | null   what we are broadcasting
//   'remote'        { active, audio, videoTrack }          what the peer is broadcasting
//   'local-stats'   { codec, impl, width, height, fps, kbps, limit } | null
//   'remote-stats'  { codec, width, height, fps, kbps, lossPct } | null

import { log } from '../core/logger.js';
import { SCREEN_CODEC_ORDER } from '../net/peer-session.js';
import { clampVolume, loadVolume, saveVolume } from './volume.js';

const VOLUME_KEY = 'cc.volume.system';

export const PRESETS = {
  detail: { label: 'TEXT/CODE', fps: 30, maxBitrate: 4_000_000, degradation: 'maintain-resolution', hint: 'detail' },
  motion: { label: 'MOTION/GAMES', fps: 60, maxBitrate: 8_000_000, degradation: 'maintain-framerate', hint: 'motion' },
};

/** Settings choices: 'auto' or a codec name as used in "video/<name>". */
export const CODEC_CHOICES = ['auto', 'AV1', 'VP9', 'VP8', 'H264'];

const SYSTEM_AUDIO_BITRATE = 128_000;
const STATS_INTERVAL_MS = 2000;
const CPU_STRIKES_TO_FALL_BACK = 3; // 3 × 2 s of "cpu" limitation
const STORAGE_KEY = 'cc.video';

export class ScreenShare extends EventTarget {
  /** @type {{ sourceId: string, name: string, withAudio: boolean, preset: string } | null} */
  local = null;
  remote = { active: false, audio: false, videoTrack: null };
  codecChoice = loadCodecChoice();
  /** Volume of the peer's shared system audio, 0–1. Remembered on this PC. */
  audioVolume = loadVolume(VOLUME_KEY);

  #session = null;
  #tracks = [];
  #remoteAudio = new Audio();
  #statsTimer = null;
  #lastOut = null;
  #lastIn = null;
  #cpuStrikes = 0;
  #cpuBanned = new Set(); // codecs that were too slow on this PC in this session
  #loggedEncoder = null;

  /**
   * @param {{ connection: import('../net/connection.js').Connection,
   *           voice: import('./voice.js').Voice,
   *           speakers: import('./speakers.js').Speakers }} deps
   */
  constructor({ connection, voice, speakers }) {
    super();
    this.connection = connection;
    this.#remoteAudio.autoplay = true;
    this.#remoteAudio.volume = this.audioVolume;
    speakers.attach(this.#remoteAudio); // the peer's system audio follows AUDIO_OUT too

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

  /**
   * Starts the broadcast, or switches a running one to another source / audio / preset without
   * stopping it: the viewer's feed changes in place. Throws with a user-facing message on failure
   * (a running broadcast then keeps going unchanged).
   */
  async start({ source, withAudio, preset }) {
    if (!this.#session) throw new Error('No active link.');
    const settings = PRESETS[preset] ?? PRESETS.detail;
    const switching = Boolean(this.local);

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

    // New capture first, old one after: the sender is never left with an ended track, so a
    // switch shows up on the viewer as a cut to the new source, not as "broadcast stopped".
    const previous = this.#tracks;
    this.#tracks = [video, audio].filter(Boolean);

    const { screen, screenAudio } = this.#session.slots;
    await screen.sender.replaceTrack(video);
    await screenAudio.sender.replaceTrack(audio);
    for (const track of previous) track.stop();
    this.#cpuStrikes = 0;
    this.#loggedEncoder = null;
    await this.#configureVideoSender(settings);
    if (audio) await tune(screenAudio.sender, { maxBitrate: SYSTEM_AUDIO_BITRATE });

    // The user closed the shared window, or Windows revoked the capture.
    video.addEventListener('ended', () => {
      if (this.#tracks.includes(video)) {
        log.warn('Shared source closed. Broadcast stopped.');
        this.stop({ quiet: true });
      }
    });

    this.local = { sourceId: source.id, name: source.name, withAudio: Boolean(audio), preset };
    this.#emit('local', this.local);
    this.#sendState();
    log.ok(`${switching ? 'Switched to' : 'Broadcasting'}: ${source.name} [${settings.label}]${audio ? ' + system audio' : ''}`);
  }

  async stop({ quiet = false } = {}) {
    if (!this.local) return;
    this.#stopTracks();
    if (this.#session) {
      await this.#session.slots.screen.sender.replaceTrack(null);
      await this.#session.slots.screenAudio.sender.replaceTrack(null);
    }
    this.local = null;
    this.#lastOut = null;
    this.#emit('local', null);
    this.#emit('local-stats', null);
    this.#sendState();
    if (!quiet) log.info('Broadcast stopped.');
  }

  setAudioVolume(volume) {
    this.audioVolume = clampVolume(volume);
    this.#remoteAudio.volume = this.audioVolume;
    saveVolume(VOLUME_KEY, this.audioVolume);
  }

  /** 'auto' or a codec name. Applies immediately if a broadcast is running. */
  async setCodecChoice(choice) {
    if (!CODEC_CHOICES.includes(choice)) return;
    this.codecChoice = choice;
    saveCodecChoice(choice);
    this.#cpuStrikes = 0;
    if (this.local) await this.#configureVideoSender(PRESETS[this.local.preset] ?? PRESETS.detail);
  }

  // --- encoder setup ---------------------------------------------------------------------

  /** Negotiated video codecs on the screen sender, without rtx/red/fec helpers. */
  #negotiatedCodecs() {
    const codecs = this.#session?.slots.screen.sender.getParameters().codecs ?? [];
    return codecs.filter((codec) => !/\/(rtx|red|ulpfec|flexfec)$/i.test(codec.mimeType));
  }

  #pickCodec() {
    const negotiated = this.#negotiatedCodecs();
    const find = (mime) => negotiated.find((codec) => codec.mimeType.toLowerCase() === mime.toLowerCase());

    if (this.codecChoice !== 'auto') {
      const wanted = find(`video/${this.codecChoice}`);
      if (wanted) return wanted;
      log.warn(`${this.codecChoice} is not available on this link (peer does not support it). Using AUTO.`);
    }
    for (const mime of SCREEN_CODEC_ORDER) {
      const codec = find(mime);
      if (codec && !this.#cpuBanned.has(mime)) return codec;
    }
    return negotiated[0] ?? null;
  }

  async #configureVideoSender(settings) {
    const codec = this.#pickCodec();
    const encoding = { maxBitrate: settings.maxBitrate, maxFramerate: settings.fps };
    if (codec) encoding.codec = { mimeType: codec.mimeType, clockRate: codec.clockRate, sdpFmtpLine: codec.sdpFmtpLine };
    await tune(this.#session.slots.screen.sender, encoding, settings.degradation);
  }

  // --- live statistics -------------------------------------------------------------------

  async #tick() {
    const session = this.#session;
    if (!session) return;
    if (this.local) await this.#tickOutbound(session).catch(() => {});
    if (this.remote.active) await this.#tickInbound(session).catch(() => {});
  }

  async #tickOutbound(session) {
    const stats = await session.slots.screen.sender.getStats();
    let out = null;
    stats.forEach((report) => {
      if (report.type === 'outbound-rtp' && report.kind === 'video') out = report;
    });
    if (!out || session !== this.#session || !this.local) return;

    const codec = stats.get(out.codecId)?.mimeType?.replace('video/', '') ?? '?';
    const kbps = rate(this.#lastOut, out, 'bytesSent');
    this.#lastOut = out;
    const hardware = out.powerEfficientEncoder === true;
    const detail = {
      codec, impl: hardware ? 'hardware' : 'software', width: out.frameWidth ?? 0, height: out.frameHeight ?? 0,
      fps: Math.round(out.framesPerSecond ?? 0), kbps, limit: out.qualityLimitationReason ?? 'none',
    };
    this.#emit('local-stats', detail);

    if (codec !== '?' && this.#loggedEncoder !== codec) {
      this.#loggedEncoder = codec;
      log.info(`Screen encoder: ${codec} (${detail.impl}${out.encoderImplementation ? `, ${out.encoderImplementation}` : ''})`);
    }
    await this.#cpuFallback(`video/${codec}`, detail.limit);
  }

  /** AUTO mode: an encoder that cannot keep up for ~6 s is replaced by the next codec. */
  async #cpuFallback(mime, limit) {
    if (this.codecChoice !== 'auto' || limit !== 'cpu') {
      this.#cpuStrikes = 0;
      return;
    }
    this.#cpuStrikes += 1;
    if (this.#cpuStrikes < CPU_STRIKES_TO_FALL_BACK) return;
    this.#cpuStrikes = 0;

    const current = SCREEN_CODEC_ORDER.findIndex((entry) => entry.toLowerCase() === mime.toLowerCase());
    const negotiated = new Set(this.#negotiatedCodecs().map((codec) => codec.mimeType.toLowerCase()));
    const next = SCREEN_CODEC_ORDER.slice(current + 1).find((entry) => negotiated.has(entry.toLowerCase()));
    if (current === -1 || !next) return; // already on the lightest codec

    this.#cpuBanned.add(SCREEN_CODEC_ORDER[current]);
    log.warn(`Screen encoder overloaded (CPU): switching ${mime.replace('video/', '')} → ${next.replace('video/', '')}.`);
    await this.#configureVideoSender(PRESETS[this.local.preset] ?? PRESETS.detail);
  }

  async #tickInbound(session) {
    const stats = await session.slots.screen.receiver.getStats();
    let inbound = null;
    stats.forEach((report) => {
      if (report.type === 'inbound-rtp' && report.kind === 'video') inbound = report;
    });
    if (!inbound || session !== this.#session || !this.remote.active) return;

    const previous = this.#lastIn;
    this.#lastIn = inbound;
    const lost = previous ? inbound.packetsLost - previous.packetsLost : 0;
    const received = previous ? inbound.packetsReceived - previous.packetsReceived : 0;
    this.#emit('remote-stats', {
      codec: stats.get(inbound.codecId)?.mimeType?.replace('video/', '') ?? '?',
      width: inbound.frameWidth ?? 0,
      height: inbound.frameHeight ?? 0,
      fps: Math.round(inbound.framesPerSecond ?? 0),
      kbps: rate(previous, inbound, 'bytesReceived'),
      lossPct: lost + received > 0 ? Math.max(0, (lost / (lost + received)) * 100) : 0,
    });
  }

  // --- session lifecycle -----------------------------------------------------------------

  #attach(session) {
    this.#session = session;
    this.#cpuBanned.clear();
    this.remote.videoTrack = session.slots.screen.receiver.track;
    this.#remoteAudio.srcObject = new MediaStream([session.slots.screenAudio.receiver.track]);
    this.#remoteAudio.play().catch(() => {});
    clearInterval(this.#statsTimer);
    this.#statsTimer = setInterval(() => this.#tick(), STATS_INTERVAL_MS);
  }

  #detach() {
    if (!this.#session) return;
    clearInterval(this.#statsTimer);
    this.#statsTimer = null;
    this.#stopTracks();
    this.#session = null;
    this.#lastOut = this.#lastIn = null;
    this.#remoteAudio.srcObject = null;
    if (this.local) {
      this.local = null;
      this.#emit('local', null);
      this.#emit('local-stats', null);
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
    if (!active) {
      this.#lastIn = null;
      this.#emit('remote-stats', null);
    }
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

/** kbps between two RTC stats reports (null on the first sample). */
function rate(previous, current, field) {
  if (!previous) return null;
  const seconds = (current.timestamp - previous.timestamp) / 1000;
  return seconds > 0 ? Math.max(0, Math.round(((current[field] - previous[field]) * 8) / 1000 / seconds)) : null;
}

function loadCodecChoice() {
  try {
    const choice = JSON.parse(localStorage.getItem(STORAGE_KEY))?.codec;
    return CODEC_CHOICES.includes(choice) ? choice : 'auto';
  } catch {
    return 'auto';
  }
}

function saveCodecChoice(codec) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ codec }));
  } catch {
    // per-device convenience only
  }
}
