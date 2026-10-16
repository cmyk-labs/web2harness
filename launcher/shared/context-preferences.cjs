// Persisted values alone do not prove a user choice. Only an explicit source does.
function normalizeContextPreferences(config) {
  for (const key of ["experimentalContextFiles", "experimentalContextTripleBudget", "experimentalBiggerContext"]) {
    if (config[key] !== undefined && typeof config[key] !== "boolean") throw new Error(`Invalid ${key}`);
  }
  const sources = config.contextPreferenceSources;
  if (sources !== undefined && (!sources || typeof sources !== "object" || Array.isArray(sources))) {
    throw new Error("Invalid contextPreferenceSources");
  }
  const filesSource = sources?.files === "user" ? "user" : "default";
  let budgetSource = sources?.budget === "user" ? "user" : "default";
  if (filesSource === "user" && typeof config.experimentalContextFiles !== "boolean") throw new Error("Missing user experimentalContextFiles");
  if (budgetSource === "user" && typeof config.experimentalContextTripleBudget !== "boolean") throw new Error("Missing user experimentalContextTripleBudget");
  const supported = config.browserInteractionMode !== "manual" && config.solAvailable !== false;
  const files = filesSource === "user" ? config.experimentalContextFiles : supported;
  if (files && !supported) throw new Error(`${config.browserInteractionMode === "manual" ? "Zero Risk" : "Luna"} does not support Context as File`);
  const triple = files && budgetSource === "user" && config.experimentalContextTripleBudget === true;
  // Turning transport off clears the optional larger budget, including its provenance.
  if (!files && config.experimentalContextTripleBudget === true) budgetSource = "default";
  const next = { ...config, experimentalContextFiles: files, experimentalContextTripleBudget: triple,
    contextPreferenceSources: { files: filesSource, budget: budgetSource } };
  delete next.experimentalBiggerContext;
  return next;
}

module.exports = { normalizeContextPreferences };
