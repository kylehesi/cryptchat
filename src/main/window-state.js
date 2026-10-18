'use strict';

// Main window size and position: a comfortable default, the old compact layout as the minimum,
// and the user's last size/position remembered across starts (per profile).

const fs = require('node:fs');
const path = require('node:path');
const { app, screen } = require('electron');

// Content-area sizes (not the OS frame), so the layout gets the same room at any DPI.
const DEFAULT_CONTENT = { width: 1160, height: 700 };
// Not much smaller than the default: the old 978×563 felt cramped. Only small screens go below
// it, never below the compact layout every panel is designed to fit.
const MIN_CONTENT = { width: 1100, height: 660 };
const COMPACT_CONTENT = { width: 978, height: 563 };
const WORK_AREA_MARGIN = 40;

/** A size from `wanted`, shrunk to fit the primary work area, but never below the compact layout. */
function fitted(wanted) {
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.max(COMPACT_CONTENT.width, Math.min(wanted.width, area.width - WORK_AREA_MARGIN)),
    height: Math.max(COMPACT_CONTENT.height, Math.min(wanted.height, area.height - WORK_AREA_MARGIN)),
  };
}

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function load() {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    const numbers = ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(state[key]));
    return numbers ? { x: state.x, y: state.y, width: state.width, height: state.height, maximized: state.maximized === true } : null;
  } catch {
    return null; // first start, or an unreadable file
  }
}

/** True if at least part of the rectangle is on a connected display. */
function isVisible(bounds) {
  return screen.getAllDisplays().some(({ workArea: area }) =>
    bounds.x < area.x + area.width - 50 && bounds.x + bounds.width > area.x + 50 &&
    bounds.y < area.y + area.height - 50 && bounds.y + bounds.height > area.y);
}

/** BrowserWindow options for size/position. */
function windowOptions() {
  const saved = load();
  if (saved && isVisible(saved)) {
    return { x: saved.x, y: saved.y, width: saved.width, height: saved.height, useContentSize: false, maximized: saved.maximized };
  }
  return { ...fitted(DEFAULT_CONTENT), useContentSize: true, maximized: false };
}

/** Applies the minimum size and starts remembering size/position for `win`. */
function track(win, { maximized }) {
  const [outerWidth, outerHeight] = win.getSize();
  const [contentWidth, contentHeight] = win.getContentSize();
  const min = fitted(MIN_CONTENT);
  win.setMinimumSize(min.width + (outerWidth - contentWidth), min.height + (outerHeight - contentHeight));
  if (maximized) win.maximize();

  win.on('close', () => {
    try {
      const bounds = win.getNormalBounds(); // the restored size, even if maximized right now
      fs.writeFileSync(stateFile(), JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
    } catch {
      // not worth failing the close for
    }
  });
}

module.exports = { windowOptions, track };
