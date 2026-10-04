// Progress is stage-local. Never derive a whole-install percentage from elapsed time.
function createRuntimeProgress(onProgress = () => {}) {
  let current;
  let startedAt;
  let lastPublishedAt = 0;
  const publish = (status, detail = {}) => onProgress({
    stage: current, status, elapsedMs: Date.now() - startedAt, ...detail,
  });
  return {
    start(stage, detail = {}) {
      current = stage;
      startedAt = Date.now();
      lastPublishedAt = startedAt;
      publish("running", detail);
    },
    advance(completedFiles, totalFiles) {
      if (completedFiles !== totalFiles && Date.now() - lastPublishedAt < 100) return;
      lastPublishedAt = Date.now();
      publish("running", { completedFiles, totalFiles });
    },
    complete(detail = {}) { publish("completed", detail); },
  };
}

module.exports = { createRuntimeProgress };
