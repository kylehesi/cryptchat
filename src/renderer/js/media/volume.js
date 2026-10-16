// Playback volumes (peer voice, peer system audio): 0–1 on the media element, remembered per PC.
//
// We stop at 100%: going louder would need Web Audio playback, which weakens Chromium's echo
// cancellation for people on speakers.

export function clampVolume(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 1;
}

export function loadVolume(key) {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? 1 : clampVolume(stored);
  } catch {
    return 1;
  }
}

export function saveVolume(key, volume) {
  try {
    localStorage.setItem(key, String(volume));
  } catch {
    // per-device convenience only
  }
}
