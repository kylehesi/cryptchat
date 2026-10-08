// Reads which network route ICE actually picked.

/** Returns { localType, remoteType, protocol, relayProtocol, rttMs } for the selected pair, or null. */
export async function getSelectedRoute(pc) {
  const stats = await pc.getStats();

  let pair = null;
  stats.forEach((report) => {
    if (report.type === 'transport' && report.selectedCandidatePairId) {
      pair = stats.get(report.selectedCandidatePairId) ?? pair;
    }
  });
  if (!pair) {
    stats.forEach((report) => {
      if (!pair && report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
        pair = report;
      }
    });
  }
  if (!pair) return null;

  const local = stats.get(pair.localCandidateId);
  const remote = stats.get(pair.remoteCandidateId);
  return {
    localType: local?.candidateType,
    remoteType: remote?.candidateType,
    protocol: local?.protocol,
    relayProtocol: local?.relayProtocol,
    rttMs: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
  };
}

/** Human-readable route label for the log. */
export function describeRoute(route) {
  const types = [route.localType, route.remoteType];
  const transport = (route.protocol ?? '?').toUpperCase();

  if (types.includes('relay')) {
    const relay = route.relayProtocol ? ` over ${route.relayProtocol.toUpperCase()}` : '';
    return `RELAY (via TURN${relay})`;
  }
  if (types.every((type) => type === 'host')) return `HOST (direct, local network, ${transport})`;
  return `SRFLX (direct, NAT traversal, ${transport})`;
}

/** Counts candidate types in an SDP, e.g. { host: 2, srflx: 1 }. */
export function countCandidates(sdp) {
  const counts = {};
  for (const match of sdp.matchAll(/^a=candidate:.* typ (\w+)/gm)) {
    counts[match[1]] = (counts[match[1]] ?? 0) + 1;
  }
  return counts;
}
