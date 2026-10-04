// No release repository is assumed before the Web2Harness repository is published.
// Packaged releases embed their repository; source/installer use can set it explicitly.
function normalizeRepository(value) {
  if (typeof value !== "string") return null;
  const repository = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(repository)
    ? repository : null;
}

function configuredRepository({ env = process.env, manifest = require("../../package.json") } = {}) {
  // An explicit invalid value must not silently select another download source.
  return normalizeRepository(env.WEB2HARNESS_REPOSITORY ?? manifest.web2harnessRepository);
}

function repositoryUrl(options) {
  const repository = configuredRepository(options);
  return repository ? `https://github.com/${repository}` : null;
}

module.exports = { configuredRepository, normalizeRepository, repositoryUrl };
