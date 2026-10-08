import { log } from '../core/logger.js';

// Per phase: label of the primary button and which controls are usable.
const PHASE_UI = {
  idle:              { primary: 'GENERATE_PAYLOAD', primaryDanger: false, primaryEnabled: true,  connectEnabled: true },
  gathering:         { primary: 'GENERATE_PAYLOAD', primaryDanger: false, primaryEnabled: false, connectEnabled: false },
  'awaiting-answer': { primary: 'TERMINATE_LINK',   primaryDanger: true,  primaryEnabled: true,  connectEnabled: true },
  'awaiting-peer':   { primary: 'TERMINATE_LINK',   primaryDanger: true,  primaryEnabled: true,  connectEnabled: false },
  connecting:        { primary: 'TERMINATE_LINK',   primaryDanger: true,  primaryEnabled: true,  connectEnabled: false },
  connected:         { primary: 'TERMINATE_LINK',   primaryDanger: true,  primaryEnabled: true,  connectEnabled: false },
  reconnecting:      { primary: 'TERMINATE_LINK',   primaryDanger: true,  primaryEnabled: true,  connectEnabled: false },
  failed:            { primary: 'TERMINATE_LINK',   primaryDanger: true,  primaryEnabled: true,  connectEnabled: false },
};

/** Wires CONNECTION_MATRIX to a Connection. */
export function mountConnectionPanel({ connection, localPayload, remotePayload, primaryButton, connectButton, remoteCard }) {
  primaryButton.addEventListener('click', () => {
    if (connection.phase === 'idle') connection.generateOffer();
    else connection.terminate();
  });

  connectButton.addEventListener('click', async () => {
    connectButton.disabled = true;
    try {
      await connection.inject(remotePayload.value);
    } finally {
      render(connection.phase);
    }
  });

  // Ctrl+Enter in the paste box = EXECUTE_CONNECT.
  remotePayload.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && event.ctrlKey && !connectButton.disabled) connectButton.click();
  });

  // Clicking the local payload selects and copies it.
  localPayload.addEventListener('click', () => {
    if (!localPayload.value) return;
    localPayload.select();
    copyToClipboard(localPayload.value);
  });

  connection.addEventListener('local-payload', ({ detail }) => {
    localPayload.value = detail.payload;
    copyToClipboard(detail.payload);
  });

  connection.addEventListener('phase', ({ detail }) => {
    if (detail.phase === 'idle') {
      localPayload.value = '';
      remotePayload.value = '';
    }
    if (detail.phase === 'connected') remotePayload.value = '';
    render(detail.phase);
  });

  function render(phase) {
    const ui = PHASE_UI[phase];
    primaryButton.textContent = ui.primary;
    primaryButton.classList.toggle('btn-danger', ui.primaryDanger);
    primaryButton.disabled = !ui.primaryEnabled;
    connectButton.disabled = !ui.connectEnabled;
    remotePayload.readOnly = !ui.connectEnabled;
    remoteCard.classList.toggle('is-online', phase === 'connected');
    remoteCard.classList.toggle('is-unstable', phase === 'reconnecting');
  }

  render(connection.phase);
}

async function copyToClipboard(text) {
  const copied = await window.cc.clipboard.writeText(text).catch(() => false);
  if (copied) log.info('Payload copied to clipboard.');
  else log.warn('Copy failed. Select the payload box and press Ctrl+C.');
}
