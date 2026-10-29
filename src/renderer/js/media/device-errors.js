// Turns capture/playback errors (DOMException names) into what happened and what to do.
// The name stays at the end in brackets, so a COPY_LOG bug report still shows the exact error.

/** getUserMedia() for the microphone failed. */
export function describeMicError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return withName(error, 'Windows blocked access. In Windows Settings → Privacy & security → Microphone, turn on "Let desktop apps access your microphone"');
    case 'NotFoundError':
    case 'OverconstrainedError':
      return withName(error, 'no microphone found, or the selected one is gone. Plug one in or pick another in MIC_SRC');
    case 'NotReadableError':
    case 'AbortError':
      return withName(error, 'the microphone could not start. Another app may hold it exclusively, its driver may have failed, or Windows privacy settings block desktop apps. Close the other app or pick another mic in MIC_SRC');
    default:
      return withName(error, error?.message || 'unknown error');
  }
}

/** setSinkId() (AUDIO_OUT) failed. */
export function describeOutputError(error) {
  switch (error?.name) {
    case 'NotFoundError':
      return withName(error, 'that device is no longer available');
    case 'NotAllowedError':
    case 'SecurityError':
      return withName(error, 'Windows did not allow switching to it');
    default:
      return withName(error, error?.message || 'unknown error');
  }
}

/** getDisplayMedia() (SHARE_SCR) failed. */
export function describeCaptureError(error) {
  switch (error?.name) {
    case 'NotReadableError':
    case 'AbortError':
      return withName(error, 'Windows could not capture that source. It may be closed, minimized, or protected (some video players block capture). Pick another source');
    case 'NotAllowedError':
    case 'NotFoundError':
      return withName(error, 'that source is no longer available. Press REFRESH and pick again');
    default:
      return withName(error, error?.message || 'unknown error');
  }
}

function withName(error, text) {
  return error?.name ? `${text} [${error.name}]` : text;
}
