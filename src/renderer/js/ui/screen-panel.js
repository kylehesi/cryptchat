import { log } from '../core/logger.js';

/** SHARE_SCR, the source picker dialog, the incoming feed, [FULL] and [ PIP ]. */
export function mountScreenPanel({ screenShare, connection, els }) {
  const { shareButton, dialog, grid, refreshButton, audioCheck, startButton, cancelButton } = els;
  const { screen, video, placeholder, badge, rxStats, fullButton, pipButton, codecSelect } = els;

  let sources = [];
  let selectedId = null;

  // --- local broadcast ---------------------------------------------------------------

  shareButton.addEventListener('click', () => {
    if (screenShare.local) screenShare.stop();
    else openPicker();
  });

  refreshButton.addEventListener('click', loadSources);
  cancelButton.addEventListener('click', () => dialog.close());

  startButton.addEventListener('click', async () => {
    const source = sources.find((item) => item.id === selectedId);
    if (!source) return;
    const preset = dialog.querySelector('input[name="share-preset"]:checked')?.value ?? 'detail';

    startButton.disabled = true;
    try {
      await screenShare.start({ source, withAudio: audioCheck.checked, preset });
      dialog.close();
    } catch (error) {
      log.err(`Broadcast failed: ${error.message}`);
    } finally {
      startButton.disabled = !selectedId;
    }
  });

  async function openPicker() {
    selectedId = null;
    startButton.disabled = true;
    dialog.showModal();
    await loadSources();
  }

  async function loadSources() {
    grid.replaceChildren(statusLine('[ SCANNING SOURCES... ]'));
    try {
      sources = await screenShare.listSources();
    } catch (error) {
      sources = [];
      log.err(`Could not list capture sources: ${error.message}`);
    }
    if (!sources.some((item) => item.id === selectedId)) selectedId = null;
    startButton.disabled = !selectedId;
    renderSources();
  }

  function renderSources() {
    if (!sources.length) {
      grid.replaceChildren(statusLine('[ NO SOURCES FOUND ]'));
      return;
    }
    grid.replaceChildren(...sources.map(sourceItem));
  }

  function sourceItem(source) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'source-item';
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', String(source.id === selectedId));
    item.title = source.name;

    let thumb;
    if (source.thumbnail) {
      thumb = document.createElement('img');
      thumb.src = source.thumbnail;
      thumb.alt = '';
    } else {
      thumb = document.createElement('div');
      thumb.className = 'source-thumb-empty';
    }

    const name = document.createElement('span');
    name.className = 'source-name';
    const kind = document.createElement('span');
    kind.className = 'source-kind';
    kind.textContent = source.kind === 'screen' ? '[SCR] ' : '[WIN] ';
    name.append(kind, source.name);

    item.append(thumb, name);
    item.addEventListener('click', () => {
      selectedId = source.id;
      startButton.disabled = false;
      for (const other of grid.children) other.setAttribute('aria-selected', String(other === item));
    });
    item.addEventListener('dblclick', () => startButton.click());
    return item;
  }

  function statusLine(text) {
    const line = document.createElement('p');
    line.className = 'placeholder-text';
    line.textContent = text;
    return line;
  }

  let broadcastName = '';
  screenShare.addEventListener('local', ({ detail }) => {
    shareButton.textContent = detail ? 'STOP_SHARE' : 'SHARE_SCR';
    shareButton.classList.toggle('btn-danger', Boolean(detail));
    badge.hidden = !detail;
    broadcastName = detail?.name ?? '';
    badge.textContent = detail ? `● BROADCASTING > ${broadcastName}` : '';
  });

  // Live encoder/decoder stats, so a bad picture can be traced to bandwidth or CPU.
  screenShare.addEventListener('local-stats', ({ detail }) => {
    if (!screenShare.local) return;
    const line = detail
      ? `\nTX ${detail.codec} (${detail.impl}) ${detail.width}×${detail.height}@${detail.fps} · ${formatKbps(detail.kbps)}${detail.limit !== 'none' ? ` · LIMIT: ${detail.limit.toUpperCase()}` : ''}`
      : '';
    badge.textContent = `● BROADCASTING > ${broadcastName}${line}`;
  });
  screenShare.addEventListener('remote-stats', ({ detail }) => {
    rxStats.hidden = !detail;
    if (detail) {
      rxStats.textContent = `RX ${detail.codec} ${detail.width}×${detail.height}@${detail.fps} · ${formatKbps(detail.kbps)} · LOSS ${detail.lossPct.toFixed(1)}%`;
    }
  });

  codecSelect.value = screenShare.codecChoice;
  codecSelect.addEventListener('change', async () => {
    await screenShare.setCodecChoice(codecSelect.value);
    log.info(`Screen codec: ${codecSelect.value.toUpperCase()}${screenShare.local ? ' (applied to the running broadcast)' : ''}.`);
  });

  connection.addEventListener('phase', ({ detail }) => {
    const live = detail.phase === 'connected' || detail.phase === 'reconnecting';
    shareButton.disabled = !live;
    if (!live && dialog.open) dialog.close();
  });
  shareButton.disabled = true;

  // --- incoming feed -----------------------------------------------------------------

  screenShare.addEventListener('remote', ({ detail }) => {
    if (detail.active && detail.videoTrack) {
      video.srcObject = new MediaStream([detail.videoTrack]);
      video.play().catch(() => {});
    } else {
      if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
      if (document.fullscreenElement === screen) document.exitFullscreen().catch(() => {});
      video.srcObject = null;
    }
    video.hidden = !detail.active;
    placeholder.hidden = detail.active;
    fullButton.disabled = !detail.active;
    pipButton.disabled = !detail.active;
  });

  fullButton.addEventListener('click', toggleFullscreen);
  video.addEventListener('dblclick', toggleFullscreen);

  pipButton.addEventListener('click', async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (error) {
      log.err(`PiP failed: ${error.message}`);
    }
  });

  function formatKbps(kbps) {
    if (kbps == null) return '...';
    return kbps >= 1000 ? `${(kbps / 1000).toFixed(2)} Mbps` : `${kbps} kbps`;
  }

  async function toggleFullscreen() {
    if (video.hidden) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await screen.requestFullscreen();
    } catch (error) {
      log.err(`Fullscreen failed: ${error.message}`);
    }
  }
}
