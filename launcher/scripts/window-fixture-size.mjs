import layout from '../electron/window-layout.cjs';

// Chromium DOM fixtures have no Electron host. Match the logical viewport after
// the product's uniform zoom; native pixel size and input alignment are checked
// separately by smoke-window-session.mjs.
export function setWindowFixtureSize(page, { width, height }) {
  const scale = layout.windowLayoutScale(width, height);
  return page.setViewportSize({ width: Math.ceil(width / scale), height: Math.ceil(height / scale) });
}
