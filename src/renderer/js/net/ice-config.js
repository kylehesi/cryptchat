// Builds the RTCConfiguration from the network settings (ARCHITECTURE §5.5).

/**
 * @param {{ stunUrls: string[], turn: { urls: string[], username: string, credential: string }, relayOnly: boolean }} config
 * @param {RTCIceServer[]} extraTurn  e.g. freshly minted Cloudflare TURN servers
 */
export function buildRtcConfig(config, extraTurn = []) {
  const iceServers = [];
  if (config.stunUrls.length) iceServers.push({ urls: config.stunUrls });
  iceServers.push(...staticTurn(config), ...extraTurn);

  return {
    iceServers,
    // Relay-only: we only offer TURN relay candidates, so the peer never learns our IP.
    iceTransportPolicy: config.relayOnly ? 'relay' : 'all',
    bundlePolicy: 'max-bundle',
  };
}

/** The user's own TURN server from settings, as RTCIceServer[] (empty if none). */
export function staticTurn(config) {
  if (!config.turn.urls.length) return [];
  return [{ urls: config.turn.urls, username: config.turn.username, credential: config.turn.credential }];
}

export function hasCloudflare(config) {
  return Boolean(config.cloudflare?.keyId && config.cloudflare?.apiToken);
}

export function hasAnyTurn(config) {
  return config.turn.urls.length > 0 || hasCloudflare(config);
}
