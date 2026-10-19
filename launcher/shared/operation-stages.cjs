"use strict";

const OPERATION_STAGE_TIMEOUTS = Object.freeze({
  // The bounded worker owns its leaf timers once a delegated browser operation runs.
  running: undefined,
  startup: 30_000,
  connection: 120_000,
  controls: 120_000,
  inspection: 60_000,
  cleanup: 120_000,
  "websocket-close": 30_000,
  config: 60_000,
  download: 300_000,
  "component-ready": 120_000,
  verification: 120_000,
  "human-login": 900_000,
  "browser-startup": 60_000,
  "page-load": 120_000,
});

// Only active leaf owners spend time. A compound operation pauses while its
// child owns the work; concurrent children retain separate clocks.
function createOperationStageWatchdog(onTimeout, { initialStage = "config", timeoutMs } = {}) {
  const active = new Map();
  let lastId = 0;
  let closed = false;
  const budget = stage => timeoutMs ?? OPERATION_STAGE_TIMEOUTS[stage];
  const arm = owner => {
    if (owner.remaining === undefined) return;
    owner.started = performance.now();
    owner.timer = setTimeout(() => {
      if (!closed) {
        stop();
        onTimeout(new Error(`${owner.stage} stage timed out after ${budget(owner.stage)}ms`));
      }
    }, Math.max(1, owner.remaining));
  };
  const pause = owner => {
    if (owner.timer === null) return;
    clearTimeout(owner.timer);
    owner.timer = null;
    if (owner.remaining !== undefined) owner.remaining -= performance.now() - owner.started;
  };
  const idle = () => {
    const owner = { id: 0, stage: initialStage, remaining: budget(initialStage), children: 0, timer: null };
    active.set(0, owner);
    arm(owner);
  };
  const stop = () => {
    closed = true;
    for (const owner of active.values()) clearTimeout(owner.timer);
    active.clear();
  };
  idle();
  return {
    stop,
    accept(message) {
      if (closed) return;
      if (!message || message.type !== "stage" || !Number.isSafeInteger(message.id) || message.id < 1) {
        throw new Error("Invalid operation stage identity");
      }
      if (message.event === "begin") {
        if (message.id <= lastId || !Object.hasOwn(OPERATION_STAGE_TIMEOUTS, message.stage)) {
          throw new Error("Invalid operation stage start");
        }
        const parentId = message.parentId ?? 0;
        const parent = active.get(parentId);
        if (!parent) throw new Error("Operation stage parent is not active");
        pause(parent);
        parent.children++;
        const owner = { id: message.id, parentId, stage: message.stage,
          remaining: budget(message.stage), children: 0, timer: null };
        lastId = message.id;
        active.set(owner.id, owner);
        arm(owner);
      } else if (message.event === "end") {
        const owner = active.get(message.id);
        if (!owner || owner.children) throw new Error("Operation stage ended without exclusive ownership");
        clearTimeout(owner.timer);
        active.delete(owner.id);
        const parent = active.get(owner.parentId);
        if (--parent.children === 0) {
          // The idle interval between items has its own budget.
          if (parent.id === 0) parent.remaining = budget(initialStage);
          arm(parent);
        }
      } else throw new Error("Invalid operation stage event");
    },
  };
}

module.exports = { OPERATION_STAGE_TIMEOUTS, createOperationStageWatchdog };
