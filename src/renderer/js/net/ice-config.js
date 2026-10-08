// Builds the RTCConfiguration. TURN servers and relay-only mode come from settings in phase 7.

// Two public STUN servers are enough; a long list only slows down candidate gathering.
const DEFAULT_STUN_URLS = ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'];

export function buildRtcConfig() {
  return {
    iceServers: [{ urls: DEFAULT_STUN_URLS }],
    iceTransportPolicy: 'all',
    bundlePolicy: 'max-bundle',
  };
}
