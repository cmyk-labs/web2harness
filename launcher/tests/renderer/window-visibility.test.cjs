const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createWindowVisibility } = require("../../electron/window-visibility.cjs");

function windowFixture() {
  return Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(), visible: false, minimized: false, destroyed: false, shows: 0,
    isDestroyed() { return this.destroyed; }, isVisible() { return this.visible; },
    isMinimized() { return this.minimized; }, restore() { this.minimized = false; },
    show() { this.visible = true; this.shows++; }, focus() {},
    hide() { this.visible = false; },
  });
}
test("normal launch opens after load even when ready-to-show is absent", () => {
  const controller = createWindowVisibility(), window = windowFixture();
  controller.attach(window);
  assert.equal(window.visible, false);
  window.webContents.emit("did-finish-load");
  assert.equal(window.visible, true);
  window.hide();
  window.emit("ready-to-show");
  window.webContents.emit("did-finish-load");
  assert.equal(window.visible, false, "late paint/reload must not reopen a user-hidden window");
});
test("ready-to-show before load opens once", () => {
  const controller = createWindowVisibility(), window = windowFixture();
  controller.attach(window);
  window.emit("ready-to-show");
  window.webContents.emit("did-finish-load");
  assert.equal(window.shows, 1);
});
test("hidden autostart remains hidden until an explicit open restores it", () => {
  const controller = createWindowVisibility(), window = windowFixture();
  controller.attach(window, { startHidden: true });
  window.webContents.emit("did-finish-load");
  window.emit("ready-to-show");
  assert.equal(window.visible, false);
  window.minimized = true;
  controller.show("second-instance");
  assert.equal(window.visible, true);
  assert.equal(window.minimized, false);
});
test("an early second instance and failed renderer cannot strand the foreground request", () => {
  const controller = createWindowVisibility(), window = windowFixture();
  controller.show("second-instance");
  controller.attach(window, { startHidden: true });
  assert.equal(window.visible, true);
  window.hide();
  window.webContents.emit("did-fail-load", {}, -2, "failed", "", true);
  controller.show("tray-click");
  assert.equal(window.visible, true);
});
test("destroyed windows are ignored and pending requests reach the next window", () => {
  const controller = createWindowVisibility(), window = windowFixture(), replacement = windowFixture();
  controller.attach(window);
  window.destroyed = true;
  window.emit("closed");
  controller.show();
  controller.attach(replacement, { startHidden: true });
  assert.equal(window.shows, 0);
  assert.equal(replacement.visible, true);
});
