import { resolve } from "node:path";
import { candidateIdentity } from "../launcher/shared/candidate-identity.cjs";

declare const __WEB2HARNESS_SOURCE_ID__: string | undefined;
// Captured when the process loads, never recomputed for health requests. A stale
// source process must keep reporting its old ID until explicitly restarted.
export const LOADED_SOURCE_ID = (() => {
  if (typeof __WEB2HARNESS_SOURCE_ID__ === "string") return __WEB2HARNESS_SOURCE_ID__;
  try { return candidateIdentity(resolve(import.meta.dir, "..")).sourceId; }
  catch { return null; } // Source archives without Git remain usable, but cannot satisfy the evidence gate.
})();
