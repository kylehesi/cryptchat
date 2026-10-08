// Manual (copy-paste) signaling: drives one PeerSession through offer → answer → connected.
// Never touches the DOM.
//
// Events (CustomEvent.detail):
//   'phase'          { phase }              see below
//   'local-payload'  { payload, type }      a payload is ready to be sent to the peer
//   'channel-open'   { name }               a DataChannel of the current session opened
//   'peer-message'   { channel, message }   a protocol message from the peer (except 'bye')
//
// Phases:
//   idle            nothing running
//   gathering       building a local payload (offer or answer)
//   awaiting-answer offerer: offer is ready, waiting for the remote answer to be injected
//   awaiting-peer   answerer: answer is ready, waiting for the offerer to apply it
//   connecting      both descriptions applied, ICE is working
//   connected       tunnel up
//   failed          ICE failed; user must terminate and retry
//
// v1 keeps a single session. Groups later become a Map<peerId, PeerSession> (ARCHITECTURE §5.1).

import { log } from '../core/logger.js';
import { buildRtcConfig } from './ice-config.js';
import { decodePayload, encodePayload, PayloadError } from './payload.js';
import { PeerSession } from './peer-session.js';
import { countCandidates, describeRoute, getSelectedRoute } from './stats.js';

export class Connection extends EventTarget {
  phase = 'idle';
  /** @type {PeerSession | null} */
  session = null;

  /** Offerer side: create a session and produce the offer payload. */
  async generateOffer() {
    if (this.phase !== 'idle') return;
    this.#setPhase('gathering');
    log.info('Gathering ICE candidates for OFFER...');

    try {
      this.#openSession('offerer');
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

    if (remote.type === 'offer') {
      if (this.phase !== 'idle') {
        log.err('Got an OFFER, but a session is already running. TERMINATE_LINK first.');
        return;
      }
      await this.#answer(remote);
    } else {
      if (this.phase !== 'awaiting-answer') {
        log.err(
          this.phase === 'idle'
            ? 'Got an ANSWER, but no OFFER was generated here. GENERATE_PAYLOAD first.'
            : 'Got an ANSWER, but this side is not waiting for one.',
        );
        return;
      }
      await this.#applyAnswer(remote);
    }
  }

  /** Sends a protocol message to the peer. Returns false if the channel is not open. */
  send(channel, type, fields) {
    return this.session?.send(channel, type, fields) ?? false;
  }

  /** Tears down the session and tells the peer, if it can still hear us. */
  terminate() {
    if (!this.session) return;
    this.session.send('control', 'bye');
    this.#closeSession();
    log.warn('Link terminated.');
  }

  async #answer(offer) {
    this.#setPhase('gathering');
    log.info(`OFFER accepted (${formatCandidates(offer.sdp)}). Gathering ICE candidates for ANSWER...`);

    try {
      this.#openSession('answerer');
      const answer = await this.session.acceptOffer(offer);
      await this.#publishLocalPayload(answer);
      this.#setPhase('awaiting-peer');
      log.info('Send this ANSWER back to your peer. The link opens once they inject it.');
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

  #openSession(role) {
    const session = new PeerSession(buildRtcConfig(), role);
    this.session = session;

    session.addEventListener('state', ({ detail }) => this.#onPeerState(session, detail.state));
    session.addEventListener('channel-open', ({ detail }) => {
      if (session === this.session) this.#emit('channel-open', detail);
    });
    session.addEventListener('message', ({ detail }) => {
      if (session !== this.session) return;
      if (detail.channel === 'control' && detail.message.type === 'bye') {
        log.warn('Remote peer terminated the link.');
        this.#closeSession();
        return;
      }
      this.#emit('peer-message', detail);
    });
  }

  #closeSession() {
    this.session?.close();
    this.session = null;
    this.#setPhase('idle');
  }

  async #onPeerState(session, state) {
    if (session !== this.session) return; // late event from a session we already dropped

    switch (state) {
      case 'connecting':
        // The offerer can see early checks from the peer before it has the answer; stay quiet then.
        if (this.phase === 'awaiting-peer') this.#setPhase('connecting');
        if (this.phase === 'connecting') log.info('ICE: checking candidate pairs...');
        break;
      case 'connected': {
        this.#setPhase('connected');
        log.ok('TUNNEL ESTABLISHED. Encrypted with DTLS.');
        const route = await getSelectedRoute(session.pc);
        if (route) {
          const rtt = route.rttMs != null ? `, RTT ${route.rttMs} ms` : '';
          log.ok(`Route: ${describeRoute(route)}${rtt}`);
        }
        break;
      }
      case 'disconnected':
        log.warn('Link unstable: peer not responding...');
        break;
      case 'failed':
        this.#setPhase('failed');
        log.err('ICE failed: no working route between peers. A TURN relay may be required. TERMINATE_LINK and retry.');
        break;
      default:
        break;
    }
  }

  async #publishLocalPayload(description) {
    const counts = countCandidates(description.sdp);
    log.info(`ICE candidates: ${formatCounts(counts)}`);
    if (!counts.srflx && !counts.relay) {
      log.warn('No public route discovered (STUN unreachable?). Only peers on the same network can connect.');
    }

    const payload = await encodePayload(description);
    log.info(`${description.type.toUpperCase()} payload ready (${payload.length} chars).`);
    this.#emit('local-payload', { payload, type: description.type });
  }

  #fail(what, error) {
    log.err(`${what}: ${error.message}`);
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

function formatCounts(counts) {
  const parts = Object.entries(counts).map(([type, count]) => `${count} ${type}`);
  return parts.length ? parts.join(', ') : 'none';
}

function formatCandidates(sdp) {
  return `candidates: ${formatCounts(countCandidates(sdp))}`;
}
