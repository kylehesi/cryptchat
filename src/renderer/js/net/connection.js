// Manual (copy-paste) signaling: drives one PeerSession through offer → answer → connected.
// Never touches the DOM.
//
// Events (CustomEvent.detail):
//   'phase'          { phase }              see below
//   'local-payload'  { payload, type }      a payload is ready to be sent to the peer
//   'channel-open'   { name }               a DataChannel of the current session opened
//   'peer-message'   { channel, message }   a protocol message from the peer (except 'bye')
//   'ended'          { reason }             a link (or attempt) ended: 'local' (we terminated),
//                                           'peer' (bye), 'lost' (timeout), 'failed' (ICE/DTLS), 'error'
//   'link-stats'     { route, rttMs, upKbps, downKbps, lossPct }   every 2 s while linked
//   'datachannel'    { channel }            the peer opened an extra channel (file transfers)
//
// Phases:
//   idle            nothing running
//   gathering       building a local payload (offer or answer)
//   awaiting-answer offerer: offer is ready, waiting for the remote answer to be injected
//   awaiting-peer   answerer: answer is ready, waiting for the offerer to apply it
//   connecting      both descriptions applied, ICE is working
//   connected       tunnel up
//   reconnecting    tunnel was up, peer stopped responding; recovering (see #beginRecovery)
//   failed          ICE never connected; user must terminate and retry
//
// v1 keeps a single session. Groups later become a Map<peerId, PeerSession> (ARCHITECTURE §5.1).

import { log } from '../core/logger.js';
import { buildRtcConfig, hasAnyTurn, hasCloudflare } from './ice-config.js';
import { decodePayload, encodePayload, PayloadError } from './payload.js';
import { PeerSession } from './peer-session.js';
import { countCandidates, describeRoute, diffSnapshots, getLinkSnapshot } from './stats.js';

const STATS_INTERVAL_MS = 2000;
const ICE_RESTART_DELAY_MS = 4000; // give ICE a chance to recover by itself first
const LINK_LOST_TIMEOUT_MS = 30000;
const HOLD_OPEN_TICK_MS = 5000; // Chromium gives up after ~15 s, so a dead gap is at most ~5 s
const WAITING_PHASES = new Set(['awaiting-peer', 'connecting']);

export class Connection extends EventTarget {
  phase = 'idle';
  /** @type {PeerSession | null} */
  session = null;

  #statsTimer = null;
  #restartTimer = null;
  #lostTimer = null;
  #holdTimer = null;
  #localSdp = null; // the last payload this side made (kept after the link ends: payloads are single-use)
  #routeKey = null;
  #lastSnapshot = null;

  /** @param {import('./network-settings.js').NetworkSettings} networkSettings */
  constructor(networkSettings) {
    super();
    this.networkSettings = networkSettings;
  }

  /** Offerer side: create a session and produce the offer payload. */
  async generateOffer() {
    if (this.phase !== 'idle' || !this.#checkNetworkReady()) return;
    this.#setPhase('gathering');
    log.info('Gathering ICE candidates for OFFER...');

    try {
      this.#openSession('offerer', await this.#resolveCloudflareTurn());
      const offer = await this.session.createOffer();
      await this.#publishLocalPayload(offer);
      this.#setPhase('awaiting-answer');
      log.info('Send this OFFER to your peer, then inject their ANSWER below.');
    } catch (error) {
      this.#fail('Could not create offer', error);
    }
  }

  /** Accepts a pasted remote payload. An offer starts the answerer flow; an answer completes the offerer flow. */
  async inject(text) {
    let remote;
    try {
      remote = await decodePayload(text);
    } catch (error) {
      if (error instanceof PayloadError) {
        log.err(error.message);
        return;
      }
      throw error;
    }

    // The most common mix-up: pasting what this side just made instead of the peer's reply.
    if (this.#localSdp && remote.sdp === this.#localSdp) {
      log.err(`That is your own ${remote.type.toUpperCase()}. Send it to your peer, and paste here what they send back.`);
      return;
    }

    const problem = wrongPayloadMessage(remote.type, this.phase);
    if (problem) {
      log.err(problem);
      return;
    }
    if (remote.type === 'offer') {
      if (!this.#checkNetworkReady()) return;
      await this.#answer(remote);
    } else {
      await this.#applyAnswer(remote);
    }
  }

  /** Sends a protocol message to the peer. Returns false if the channel is not open. */
  send(channel, type, fields) {
    return this.session?.send(channel, type, fields) ?? false;
  }

  /** Opens an extra DataChannel on the live link, or returns null if there is none. */
  openChannel(label) {
    return this.phase === 'connected' || this.phase === 'reconnecting' ? this.session.openChannel(label) : null;
  }

  /** Tears down the session and tells the peer, if it can still hear us. */
  terminate() {
    const session = this.session;
    if (!session) return;
    this.#closeSession({ keepTransport: true }); // UI and modules go idle at once (file pumps stop)
    session.closeGracefully(); // then 'bye', and the transport closes once it has left
    log.warn('Link terminated.', { notify: false }); // our own action: no alarm
    this.#emit('ended', { reason: 'local' });
  }

  async #answer(offer) {
    this.#setPhase('gathering');
    log.info(`OFFER accepted (${formatCandidates(offer.sdp)}). Gathering ICE candidates for ANSWER...`);

    try {
      this.#openSession('answerer', await this.#resolveCloudflareTurn());
      const answer = await this.session.acceptOffer(offer);
      await this.#publishLocalPayload(answer);
      this.#setPhase('awaiting-peer');
      log.info('Send this ANSWER back to your peer. The link opens once they inject it.');
      this.#startHoldOpen();
    } catch (error) {
      this.#fail('Could not create answer', error);
    }
  }

  async #applyAnswer(answer) {
    log.info(`ANSWER accepted (${formatCandidates(answer.sdp)}). Connecting...`);
    try {
      await this.session.acceptAnswer(answer);
      this.#setPhase('connecting');
    } catch (error) {
      this.#fail('Could not apply answer', error);
    }
  }

  #checkNetworkReady() {
    const config = this.networkSettings.config;
    if (!config) {
      log.err('Network settings are still loading. Try again in a moment.');
      return false;
    }
    if (config.relayOnly && !hasAnyTurn(config)) {
      log.err('RELAY_ONLY is on, but no TURN server is set up. In Settings → NETWORK, add one or turn RELAY_ONLY off.');
      return false;
    }
    return true;
  }

  /** Fresh Cloudflare TURN credentials if configured (cached in the main process for ~24 h). */
  async #resolveCloudflareTurn() {
    const config = this.networkSettings.config;
    if (!hasCloudflare(config)) return [];

    const result = await window.cc.turn.cloudflare(config.cloudflare.keyId, config.cloudflare.apiToken);
    if (result.ok) {
      log.info(`Cloudflare TURN ready (${result.iceServers.flatMap((server) => server.urls).length} URLs).`);
      return result.iceServers;
    }
    if (config.relayOnly && !config.turn.urls.length) throw new Error(`Cloudflare TURN unavailable: ${result.error}`);
    log.warn(`Cloudflare TURN unavailable (${result.error}). Continuing without it.`);
    return [];
  }

  #openSession(role, extraTurn = []) {
    const config = this.networkSettings.config;
    if (config.relayOnly) log.info('RELAY_ONLY: only TURN relay candidates are offered. Your IP stays hidden from the peer.');
    else if (!config.turn.urls.length && !extraTurn.length) log.info('No TURN relay configured: strict NATs (CGNAT) may fail to connect.');

    const session = new PeerSession(buildRtcConfig(config, extraTurn), role);
    this.session = session;

    session.addEventListener('state', ({ detail }) => this.#onPeerState(session, detail.state));
    session.addEventListener('channel-open', ({ detail }) => {
      if (session === this.session) this.#emit('channel-open', detail);
    });
    session.addEventListener('message', ({ detail }) => {
      if (session !== this.session) return;
      if (detail.channel === 'control' && detail.message.type === 'bye') {
        log.warn('Remote peer terminated the link.');
        this.#emit('ended', { reason: 'peer' });
        this.#closeSession();
        return;
      }
      this.#emit('peer-message', detail);
    });
    session.addEventListener('datachannel', ({ detail }) => {
      if (session === this.session) this.#emit('datachannel', detail);
      else detail.channel.close();
    });
    session.addEventListener('signal-error', ({ detail }) => {
      if (session === this.session) log.warn(`Renegotiation failed: ${detail.error.message}`);
    });
  }

  #closeSession({ keepTransport = false } = {}) {
    this.#stopTimers();
    if (!keepTransport) this.session?.close();
    this.session = null;
    this.#routeKey = null;
    this.#lastSnapshot = null;
    this.#setPhase('idle');
  }

  #stopTimers() {
    this.#stopHoldOpen();
    clearInterval(this.#statsTimer);
    clearTimeout(this.#restartTimer);
    clearTimeout(this.#lostTimer);
    this.#statsTimer = this.#restartTimer = this.#lostTimer = null;
  }

  // HOLD_OPEN (answerer): the offerer only starts its checks once its user has pasted our
  // answer, which can take minutes. Until then PeerSession.holdOpen() keeps our checks, and with
  // them our NAT's filter, alive. Stops when the link is up or after the configured time.
  #startHoldOpen() {
    const seconds = this.networkSettings.config.holdOpenSec ?? 0;
    if (!seconds) return;
    const session = this.session;
    const deadline = Date.now() + seconds * 1000;
    log.info(`HOLD_OPEN: this side stays reachable for ${formatDuration(seconds)} while the peer injects the ANSWER.`);

    this.#holdTimer = setInterval(async () => {
      if (session !== this.session || !WAITING_PHASES.has(this.phase)) {
        this.#stopHoldOpen();
        return;
      }
      if (Date.now() >= deadline) {
        this.#stopHoldOpen();
        log.warn(`HOLD_OPEN ended after ${formatDuration(seconds)}. If the peer injects the ANSWER now, the link may need TURN. Generate new payloads if it fails.`, { notify: false });
        if (session.pc.connectionState === 'failed') this.#onPeerState(session, 'failed');
        return;
      }
      await session.holdOpen().catch(() => {});
    }, HOLD_OPEN_TICK_MS);
  }

  #stopHoldOpen() {
    clearInterval(this.#holdTimer);
    this.#holdTimer = null;
  }

  // The peer stopped answering. Short outages (Wi-Fi blip, same IP) heal by themselves within
  // seconds. If not, an ICE restart is negotiated over the control channel: that works while
  // any path still carries data, e.g. a second interface. If the old path is completely gone
  // (new network on both ends of the only path), nothing can carry the restart offer without a
  // signaling server, so after LINK_LOST_TIMEOUT_MS we give up and ask for new payloads.
  #beginRecovery(reason) {
    if (this.phase === 'reconnecting') return;
    this.#setPhase('reconnecting');
    log.warn(reason);

    this.#restartTimer = setTimeout(() => {
      if (this.phase !== 'reconnecting') return;
      log.info('Attempting ICE restart over the control channel...');
      this.session.restartIce();
    }, ICE_RESTART_DELAY_MS);

    this.#lostTimer = setTimeout(() => {
      log.err(`Link lost: peer unreachable for ${LINK_LOST_TIMEOUT_MS / 1000} s. Generate a new payload to reconnect.`);
      this.#emit('ended', { reason: 'lost' });
      this.#closeSession();
    }, LINK_LOST_TIMEOUT_MS);
  }

  #endRecovery() {
    clearTimeout(this.#restartTimer);
    clearTimeout(this.#lostTimer);
    this.#restartTimer = this.#lostTimer = null;
  }

  async #pollStats() {
    const session = this.session;
    if (!session) return;
    const snapshot = await getLinkSnapshot(session.pc).catch(() => null);
    if (session !== this.session || !snapshot?.route) return;
    const { route } = snapshot;
    const rates = diffSnapshots(this.#lastSnapshot, snapshot);
    this.#lastSnapshot = snapshot;

    const key = `${route.localType}/${route.remoteType}/${route.protocol}`;
    if (key !== this.#routeKey) {
      const rtt = route.rttMs != null ? `, RTT ${route.rttMs} ms` : '';
      if (this.#routeKey) log.info(`Route changed: ${describeRoute(route)}${rtt}`);
      else log.ok(`Route: ${describeRoute(route)}${rtt}`);
      this.#routeKey = key;
    }
    this.#emit('link-stats', { route, rttMs: route.rttMs, ...rates });
  }

  async #onPeerState(session, state) {
    if (session !== this.session) return; // late event from a session we already dropped

    switch (state) {
      case 'connecting':
        // The offerer can see early checks from the peer before it has the answer; stay quiet then.
        // HOLD_OPEN restarts checks every ~20 s: say it once, not every round.
        if (this.phase === 'awaiting-peer') {
          this.#setPhase('connecting');
          log.info('ICE: checking candidate pairs...');
        } else if (this.phase === 'connecting' && !this.#holdTimer) {
          log.info('ICE: checking candidate pairs...');
        }
        break;
      case 'connected': {
        const recovered = this.phase === 'reconnecting';
        this.#stopHoldOpen();
        this.#endRecovery();
        this.#setPhase('connected');
        log.ok(recovered ? 'Link restored.' : 'TUNNEL ESTABLISHED. Encrypted with DTLS.');
        this.#statsTimer ??= setInterval(() => this.#pollStats(), STATS_INTERVAL_MS);
        await this.#pollStats();
        break;
      }
      case 'disconnected':
        if (this.phase === 'connected') this.#beginRecovery('Link unstable: peer not responding. Waiting for recovery...');
        break;
      case 'failed':
        if (this.phase === 'connected' || this.phase === 'reconnecting') {
          // 'failed' never heals by itself: restart right away instead of waiting.
          this.#beginRecovery('Link failed. Recovering...');
          clearTimeout(this.#restartTimer);
          log.info('Attempting ICE restart over the control channel...');
          session.restartIce();
        } else if (this.#holdTimer && session.pc.sctp?.transport.state !== 'failed') {
          // ICE gave up, but HOLD_OPEN starts the checks again: the peer may still be pasting.
        } else {
          this.#setPhase('failed');
          this.#emit('ended', { reason: 'failed' });
          if (session.pc.sctp?.transport.state === 'failed') {
            // The network path worked, but the certificates did not match the payloads.
            log.err('SECURE HANDSHAKE (DTLS) FAILED: the payloads do not belong together or were altered in transit. Possible tampering. TERMINATE_LINK and exchange new payloads over a channel you trust.');
          } else {
            log.err('ICE failed: no working route between the two networks. Press NAT_CHECK on both sides: whoever is behind a symmetric NAT or blocked UDP needs TURN (Settings → NETWORK). Then TERMINATE_LINK and exchange new payloads.');
          }
        }
        break;
      default:
        break;
    }
  }

  async #publishLocalPayload(description) {
    const counts = countCandidates(description.sdp);
    log.info(`ICE candidates: ${formatCounts(counts)}`);
    if (this.networkSettings.config.relayOnly && !counts.relay) {
      // A relay-only payload without relay candidates can never connect: refuse to emit it.
      throw new Error('no relay candidate. The TURN server is unreachable or rejected the credentials. Run TEST_TURN in SETTINGS.');
    }
    if (!counts.srflx && !counts.relay) {
      log.warn('No public address found (no STUN server answered). Only a peer on the same network can connect. Check the internet connection, or press NAT_CHECK.');
    }

    this.#localSdp = description.sdp;
    const payload = await encodePayload(description);
    log.info(`${description.type.toUpperCase()} payload ready (${payload.length} chars).`);
    this.#emit('local-payload', { payload, type: description.type });
  }

  /** Debug/test hook: force an ICE restart on a live link. */
  restartIce() {
    if (this.phase === 'connected' || this.phase === 'reconnecting') this.session.restartIce();
  }

  #fail(what, error) {
    log.err(`${what}: ${describeSignalingError(error)}`);
    this.#closeSession();
  }

  #setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.#emit('phase', { phase });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

/** Why a pasted payload does not fit this side's state, or null if it does. */
function wrongPayloadMessage(type, phase) {
  if (type === 'offer') {
    if (phase === 'idle') return null;
    if (phase === 'awaiting-answer') {
      return "You both pressed GENERATE_PAYLOAD: that is your peer's OFFER, but this side made one too. Only one side generates. Either paste your OFFER on their side, or TERMINATE_LINK here and inject theirs.";
    }
    return phase === 'connected' || phase === 'reconnecting'
      ? 'Got an OFFER, but you are already linked. TERMINATE_LINK first to start a new link.'
      : 'Got an OFFER, but this side already answered one. TERMINATE_LINK first to start over.';
  }
  if (phase === 'awaiting-answer') return null;
  if (phase === 'idle') {
    return 'Got an ANSWER, but this side has no OFFER waiting (the link was terminated, or the app restarted). Payloads are single-use: GENERATE_PAYLOAD and send a new OFFER.';
  }
  if (phase === 'awaiting-peer') {
    return 'Got an ANSWER, but this side answered an OFFER itself. The ANSWER belongs on the side that generated the OFFER.';
  }
  return 'Got an ANSWER, but this side is not waiting for one (it is already connecting or linked).';
}

/** A readable reason for a failed offer/answer step (the browser's own text is for developers). */
function describeSignalingError(error) {
  if (error instanceof PayloadError || !['OperationError', 'InvalidAccessError', 'SyntaxError', 'InvalidModificationError'].includes(error?.name)) {
    return error?.message ?? String(error);
  }
  return `the payload is damaged or does not belong to this link (${error.name}). Ask your peer to copy it again, or start over with new payloads.`;
}

function formatCounts(counts) {
  const parts = Object.entries(counts).map(([type, count]) => `${count} ${type}`);
  return parts.length ? parts.join(', ') : 'none';
}

function formatCandidates(sdp) {
  return `candidates: ${formatCounts(countCandidates(sdp))}`;
}

function formatDuration(seconds) {
  return seconds < 60 ? `${seconds} s` : `${seconds / 60} min`;
}
