const STICK_THRESHOLD_PX = 24;

/**
 * Appends `line` to a scrolling log, drops the oldest lines beyond `maxLines`, and keeps the
 * view pinned to the bottom only if the user was already there (so reading history is not
 * interrupted by new lines).
 */
export function appendToLog(container, line, maxLines) {
  const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < STICK_THRESHOLD_PX;
  container.append(line);
  while (container.childElementCount > maxLines) container.firstElementChild.remove();
  if (atBottom) container.scrollTop = container.scrollHeight;
}
