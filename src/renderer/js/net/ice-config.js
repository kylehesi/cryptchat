// Builds the RTCConfiguration from the network settings (ARCHITECTURE §5.5).

/** @param {{ stunUrls: string[], turn: { urls: string[], username: string, credential: string }, relayOnly: boolean }} config */
export function buildRtcConfig(config) {
  const iceServers = [];
  if (config.stunUrls.length) iceServers.push({ urls: config.stunUrls });
  if (config.turn.urls.length) {
    iceServers.push({ urls: config.turn.urls, username: config.turn.username, credential: config.turn.credential });
  }

  return {
    iceServers,
    // Relay-only: we only offer TURN relay candidates, so the peer never learns our IP.
    iceTransportPolicy: config.relayOnly ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
  };
}
