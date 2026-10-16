const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeWindowState,
  readWindowState,
  writeWindowState,
  WINDOW_SIZING_REVISION,
} = require("../../electron/window-state.cjs");

const displays = [{ workArea: { x: 0, y: 0, width: 1512, height: 982 } }];

test("legacy normal dimensions shrink once and later manual resizing survives", () => {
  const migrated = normalizeWindowState({ bounds: { width: 1440, height: 1000 } }, displays);
  assert.equal(migrated.bounds.width, 1000);
  assert.equal(migrated.bounds.height, 660);
  const resized = { ...migrated, bounds: { ...migrated.bounds, width: 1200, height: 800 } };
  assert.equal(normalizeWindowState(resized, displays).bounds.width, 1200);
  assert.deepEqual(normalizeWindowState({ bounds: { width: 680, height: 500 } }).bounds, { width: 900, height: 600 });
});

test("previous default grows once while other saved sizes and later minimum choices survive", () => {
  const migrated = normalizeWindowState({ sizingRevision: 1, bounds: { x: 20, y: 30, width: 900, height: 600 } }, displays);
  assert.deepEqual(migrated.bounds, { x: 20, y: 30, width: 1000, height: 660 });
  assert.equal(migrated.sizingRevision, WINDOW_SIZING_REVISION);
  assert.deepEqual(normalizeWindowState({ sizingRevision: 1, bounds: { width: 640, height: 480 } }).bounds, { width: 900, height: 600 });
  assert.deepEqual(normalizeWindowState({ sizingRevision: 1, bounds: { width: 1100, height: 700 } }).bounds, { width: 1100, height: 700 });
  assert.deepEqual(normalizeWindowState({ ...migrated, bounds: { width: 900, height: 600 } }).bounds, { width: 900, height: 600 });
});

test("layout scale preserves the design aspect ratio within default, minimum and maximized windows", () => {
  const { windowLayoutScale, DESIGN_WIDTH, DESIGN_HEIGHT } = require("../../electron/window-layout.cjs");
  for (const [width, height] of [[1000, 660], [900, 600], [1920, 1080], [500, 350]]) {
    const scale = windowLayoutScale(width, height);
    assert.ok(DESIGN_WIDTH * scale <= width + 0.001);
    assert.ok(DESIGN_HEIGHT * scale <= height + 0.001);
    assert.ok(Math.abs((DESIGN_WIDTH * scale) / (DESIGN_HEIGHT * scale) - DESIGN_WIDTH / DESIGN_HEIGHT) < 1e-12);
  }
});

test("startup preserves normal bounds but does not restore maximized or fullscreen modes", () => {
  assert.deepEqual(normalizeWindowState({ sizingRevision: 1,
    bounds: { x: 120, y: 80, width: 1280, height: 800 },
    maximized: true,
    fullscreen: true,
  }, displays), {
    bounds: { x: 120, y: 80, width: 1280, height: 800 },
    sizingRevision: WINDOW_SIZING_REVISION,
    maximized: false,
    fullscreen: false,
  });
});

test("window state drops off-screen positions and enforces minimum dimensions", () => {
  assert.deepEqual(normalizeWindowState({ sizingRevision: 1,
    bounds: { x: 9000, y: 9000, width: 200, height: 100 },
  }, displays), {
    bounds: { x: 306, y: 191, width: 900, height: 600 },
    sizingRevision: WINDOW_SIZING_REVISION,
    maximized: false,
    fullscreen: false,
  });
});

test("window state caps corrupt oversized dimensions", () => {
  const state = normalizeWindowState({ sizingRevision: 1,
    bounds: { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER },
  }, displays);
  assert.deepEqual(state.bounds, { x: 0, y: 0, width: 1512, height: 982 });
  assert.deepEqual(normalizeWindowState({ sizingRevision: 1, bounds: { width: Infinity, height: NaN } }).bounds,
    { width: 1000, height: 660 });
});

test("first launch fits a short display work area and centers without a saved position", () => {
  assert.deepEqual(normalizeWindowState(null, [{ workArea: { x: 40, y: 24, width: 1280, height: 680 } }]).bounds,
    { x: 180, y: 34, width: 1000, height: 660 });
});

test("partially visible oversized windows keep every edge inside the selected work area", () => {
  assert.deepEqual(normalizeWindowState({ sizingRevision: 1, bounds: { x: 100, y: -80, width: 1500, height: 950 } },
    [{ workArea: { x: 0, y: 0, width: 1280, height: 680 } }]).bounds,
    { x: 0, y: 0, width: 1280, height: 680 });
});

test("restore chooses the largest overlap including displays with negative coordinates", () => {
  const screens = [displays[0], { workArea: { x: -1280, y: 0, width: 1280, height: 680 } }];
  assert.deepEqual(normalizeWindowState({ sizingRevision: 1, bounds: { x: -1100, y: 100, width: 1120, height: 720 } }, screens).bounds,
    { x: -1120, y: 0, width: 1120, height: 680 });
});

test("disconnected displays fall back to the primary work area", () => {
  assert.deepEqual(normalizeWindowState({ sizingRevision: 1, bounds: { x: -6000, y: 0, width: 1120, height: 720 } }, displays).bounds,
    { x: 196, y: 131, width: 1120, height: 720 });
});

test("small work areas take priority over minimum bounds and invalid display data is ignored", () => {
  assert.deepEqual(normalizeWindowState(null, [{ workArea: { x: 0, y: 0, width: 0, height: 0 } },
    { workArea: { x: 0, y: 0, width: 640, height: 480 } }]).bounds,
    { x: 0, y: 0, width: 640, height: 480 });
});

test("window state is stored atomically with owner-only permissions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "web2harness-window-state-"));
  const file = path.join(root, "window-state.json");
  try {
    const state = {
      bounds: { x: 20, y: 30, width: 1120, height: 720 },
      sizingRevision: WINDOW_SIZING_REVISION,
      maximized: false,
      fullscreen: false,
    };
    writeWindowState(file, state);
    assert.deepEqual(readWindowState(file, displays), state);
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o077, 0);
    assert.equal(fs.readdirSync(root).some((name) => name.includes(".tmp-")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
