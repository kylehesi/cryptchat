'use strict';

// Main window size and position: a comfortable default, the old compact layout as the minimum,
// and the user's last size/position remembered across starts (per profile).

const fs = require('node:fs');
const path = require('node:path');
const { app, screen } = require('electron');

// Content-area sizes (not the OS frame), so the layout gets the same room at any DPI.
const DEFAULT_CONTENT = { width: 1160, height: 700 };
// The compact layout: 480px left column + the A/V side at its designed minimum (614px).
const MIN_CONTENT = { width: 1106, height: 563 };
const WORK_AREA_MARGIN = 40;

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
  // Default: comfortable size, shrunk to fit small screens, never below the compact layout.
  const area = screen.getPrimaryDisplay().workAreaSize;
  return {
    width: Math.max(MIN_CONTENT.width, Math.min(DEFAULT_CONTENT.width, area.width - WORK_AREA_MARGIN)),
    height: Math.max(MIN_CONTENT.height, Math.min(DEFAULT_CONTENT.height, area.height - WORK_AREA_MARGIN)),
    useContentSize: true,
    maximized: false,
  };
}

/** Applies the minimum size and starts remembering size/position for `win`. */
function track(win, { maximized }) {
  const [outerWidth, outerHeight] = win.getSize();
  const [contentWidth, contentHeight] = win.getContentSize();
  win.setMinimumSize(MIN_CONTENT.width + (outerWidth - contentWidth), MIN_CONTENT.height + (outerHeight - contentHeight));
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
