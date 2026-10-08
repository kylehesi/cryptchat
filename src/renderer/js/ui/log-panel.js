import { log } from '../core/logger.js';

const MAX_LINES = 300;
const STICK_THRESHOLD_PX = 24;

const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

/** Renders log entries into `container`, auto-scrolling only if the user is already at the bottom. */
export function mountLogPanel(container) {
  return log.subscribe((entry) => {
    const atBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < STICK_THRESHOLD_PX;

    const line = document.createElement('div');
    line.className = `log-line log-${entry.level}`;
    line.textContent = `[${timeFormat.format(entry.time)}] ${entry.message}`;
    container.append(line);

    while (container.childElementCount > MAX_LINES) container.firstElementChild.remove();
    if (atBottom) container.scrollTop = container.scrollHeight;
  });
}
