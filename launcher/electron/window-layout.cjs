const DESIGN_WIDTH = 1120;
const DESIGN_HEIGHT = 720;

function windowLayoutScale(width, height) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return 1;
  // Keep compact windows usable without magnifying the whole UI on large displays.
  return Math.min(1, width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
}

function fitWindowLayout(window) {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return;
  const [width, height] = window.getContentSize();
  const scale = windowLayoutScale(width, height);
  window.webContents.setZoomFactor(scale);
  if (process.platform !== "darwin") window.setTitleBarOverlay({ height: Math.max(28, Math.round(46 * scale)) });
}

module.exports = { DESIGN_WIDTH, DESIGN_HEIGHT, windowLayoutScale, fitWindowLayout };
