// Link statistics from RTCPeerConnection.getStats().

/**
 * One snapshot of the link. Bitrate and loss come from differences between two snapshots
 * (see diffSnapshots).
 * @returns {Promise<{ route: object | null, time: number, bytesSent: number, bytesReceived: number,
 *                     packetsLost: number, packetsReceived: number }>}
 */
export async function getLinkSnapshot(pc) {
  const stats = await pc.getStats();
  const snapshot = { route: null, time: performance.now(), bytesSent: 0, bytesReceived: 0, packetsLost: 0, packetsReceived: 0 };

  let pair = null;
  stats.forEach((report) => {
    if (report.type === 'transport') {
      snapshot.bytesSent += report.bytesSent ?? 0;
      snapshot.bytesReceived += report.bytesReceived ?? 0;
      if (report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId) ?? pair;
    } else if (report.type === 'inbound-rtp') {
      snapshot.packetsLost += Math.max(0, report.packetsLost ?? 0);
      snapshot.packetsReceived += report.packetsReceived ?? 0;
    }
  });
  if (!pair) {
    stats.forEach((report) => {
      if (!pair && report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') pair = report;
    });
  }

  if (pair) {
    const local = stats.get(pair.localCandidateId);
    const remote = stats.get(pair.remoteCandidateId);
    snapshot.route = {
      localType: local?.candidateType,
      remoteType: remote?.candidateType,
      protocol: local?.protocol,
      relayProtocol: local?.relayProtocol,
      rttMs: pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null,
    };
  }
  return snapshot;
}

/** { upKbps, downKbps, lossPct } between two snapshots (null fields if not computable). */
export function diffSnapshots(previous, current) {
  const seconds = previous ? (current.time - previous.time) / 1000 : 0;
  if (seconds <= 0) return { upKbps: null, downKbps: null, lossPct: null };

  const lost = current.packetsLost - previous.packetsLost;
  const received = current.packetsReceived - previous.packetsReceived;
  return {
    upKbps: Math.max(0, Math.round(((current.bytesSent - previous.bytesSent) * 8) / 1000 / seconds)),
    downKbps: Math.max(0, Math.round(((current.bytesReceived - previous.bytesReceived) * 8) / 1000 / seconds)),
    lossPct: lost + received > 0 ? Math.max(0, (lost / (lost + received)) * 100) : 0,
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
