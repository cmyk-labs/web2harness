"use strict";

const BROWSER_SURFACE_ACTIVE_CHANNEL = "launcher:browser-surface-active";
function validateBrowserSurfaceActive(value) {
  if (typeof value !== "boolean") throw new Error("Browser surface active must be a boolean / 浏览器展示状态必须为布尔值");
  return value;
}
module.exports = { BROWSER_SURFACE_ACTIVE_CHANNEL, validateBrowserSurfaceActive };
