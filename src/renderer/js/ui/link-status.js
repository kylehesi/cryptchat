// "LINK: SRFLX · 23 ms" in the KERNEL_LOG header.

const ROUTE_LABEL = { host: 'HOST', srflx: 'SRFLX', prflx: 'SRFLX', relay: 'RELAY' };

export function mountLinkStatus({ connection, element }) {
  let lastStats = null;

  connection.addEventListener('link-stats', ({ detail }) => {
    lastStats = detail;
    render();
  });
  connection.addEventListener('phase', ({ detail }) => {
    if (detail.phase === 'idle') lastStats = null;
    render();
  });

  function render() {
    const { phase } = connection;
    element.classList.toggle('is-online', phase === 'connected');
    element.classList.toggle('is-unstable', phase === 'reconnecting');

    if (phase === 'reconnecting') {
      element.textContent = 'LINK: UNSTABLE';
    } else if (phase === 'connected' && lastStats) {
      const rtt = lastStats.rttMs != null ? ` · ${lastStats.rttMs} ms` : '';
      element.textContent = `LINK: ${routeLabel(lastStats.route)}${rtt}`;
    } else if (phase === 'connected' || phase === 'connecting') {
      element.textContent = 'LINK: ...';
    } else {
      element.textContent = 'LINK: OFFLINE';
    }
  }

  render();
}

function routeLabel(route) {
  const types = [route.localType, route.remoteType];
  if (types.includes('relay')) return ROUTE_LABEL.relay;
  if (types.every((type) => type === 'host')) return ROUTE_LABEL.host;
  return ROUTE_LABEL.srflx;
}
