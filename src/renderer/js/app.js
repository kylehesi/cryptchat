// Phase 0 placeholder: proves that ES modules load and the preload bridge works.
const { electron, chrome, node } = window.cc.versions;

document.getElementById('boot').textContent = [
  '--- SYSTEM BOOT ---',
  `electron ${electron} / chromium ${chrome} / node ${node}`,
  `secure context: ${window.isSecureContext}`,
].join('\n');
