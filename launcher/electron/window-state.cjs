const fs = require("node:fs");
const { writePrivateFileAtomic } = require("./common/atomic-file.cjs");

const DEFAULT_WINDOW_STATE = Object.freeze({
  bounds: { width: 1120, height: 720 },
  maximized: false,
  fullscreen: false,
});
const MIN_WINDOW_BOUNDS = Object.freeze({ width: 720, height: 600 });
const MAX_WINDOW_DIMENSION = 16_384;

function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function visibleWorkArea(bounds, displays) {
  const areas = displays.map((display) => display?.workArea).filter((area) =>
    area && [area.x, area.y, area.width, area.height].every(Number.isFinite)
      && area.width > 0 && area.height > 0);
  let selected = areas[0];
  let overlap = 0;
  for (const area of areas) {
    const width = Math.max(0, Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x));
    const height = Math.max(0, Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y));
    if (width * height > overlap) {
      selected = area;
      overlap = width * height;
    }
  }
  return { area: selected, overlaps: overlap > 0 };
}

function normalizeWindowState(value, displays = []) {
  const saved = value && typeof value === "object" ? value : {};
  const bounds = saved.bounds && typeof saved.bounds === "object" ? saved.bounds : {};
  const state = {
    bounds: {
      width: Math.min(
        MAX_WINDOW_DIMENSION,
        Math.max(MIN_WINDOW_BOUNDS.width, finiteNumber(bounds.width, DEFAULT_WINDOW_STATE.bounds.width)),
      ),
      height: Math.min(
        MAX_WINDOW_DIMENSION,
        Math.max(MIN_WINDOW_BOUNDS.height, finiteNumber(bounds.height, DEFAULT_WINDOW_STATE.bounds.height)),
      ),
    },
    // Restore normal bounds, but always open visibly in a normal window.
    maximized: false,
    fullscreen: false,
  };
  const hasPosition = Number.isFinite(bounds.x) && Number.isFinite(bounds.y);
  const { area, overlaps } = visibleWorkArea({ ...state.bounds, x: bounds.x, y: bounds.y }, displays);
  if (area) {
    // Work areas are in DIP, including the OS display scale and taskbar inset.
    // Small displays take precedence over the usual minimum window size.
    state.bounds.width = Math.min(state.bounds.width, area.width);
    state.bounds.height = Math.min(state.bounds.height, area.height);
    const x = hasPosition && overlaps ? bounds.x : area.x + (area.width - state.bounds.width) / 2;
    const y = hasPosition && overlaps ? bounds.y : area.y + (area.height - state.bounds.height) / 2;
    state.bounds.x = Math.round(Math.max(area.x, Math.min(x, area.x + area.width - state.bounds.width)));
    state.bounds.y = Math.round(Math.max(area.y, Math.min(y, area.y + area.height - state.bounds.height)));
  } else if (hasPosition) {
    state.bounds.x = bounds.x;
    state.bounds.y = bounds.y;
  }
  return state;
}

function readWindowState(filePath, displays = []) {
  try {
    return normalizeWindowState(JSON.parse(fs.readFileSync(filePath, "utf8")), displays);
  } catch {
    return normalizeWindowState(null, displays);
  }
}

function writeWindowState(filePath, state) {
  writePrivateFileAtomic(filePath, `${JSON.stringify(state, null, 2)}\n`);
}

function captureWindowState(window) {
  return {
    bounds: window.isMaximized() || window.isFullScreen() ? window.getNormalBounds() : window.getBounds(),
    maximized: window.isMaximized(),
    fullscreen: window.isFullScreen(),
  };
}

function trackWindowState(window, filePath, onError) {
  let timer = null;
  const capture = () => {
    timer = null;
    if (window.isDestroyed()) return;
    try {
      writeWindowState(filePath, captureWindowState(window));
    } catch (error) {
      onError?.(error);
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(capture, 400);
  };
  for (const event of ["resize", "move", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) {
    window.on(event, schedule);
  }
  window.on("close", () => {
    if (timer) clearTimeout(timer);
    capture();
  });
}

module.exports = {
  DEFAULT_WINDOW_STATE,
  MIN_WINDOW_BOUNDS,
  captureWindowState,
  normalizeWindowState,
  readWindowState,
  trackWindowState,
  writeWindowState,
};
