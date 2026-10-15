import { createHash } from "node:crypto";

export const REQUIRED_CASES = ["CAP-001", "CAP-002", "CAP-003", "CAP-004", "CAP-005", "CAP-006", "CAP-008", "CAP-009", "CAP-010",
  ...Array.from({ length: 17 }, (_, i) => `Q${String(i + 1).padStart(2, "0")}`)];
export type Layer = "fixture" | "authenticated-dev" | "native-package";
export type Mode = "native-tools" | "automatic-mcp" | "manual-mcp" | "desktop" | "not-applicable";
export interface AcceptanceCheck {
  id: string; cases: string[]; criterion: string; layers: Layer[]; modes: Mode[]; dependencies: string[];
}
const runtime = ["src/", "launcher/electron/", "launcher/shared/", "package.json", "bun.lock", "launcher/package.json", "launcher/bun.lock",
  "scripts/build", "scripts/install", "scripts/prepare", "tests/fixtures/"];
const ui = [...runtime, "launcher/src/", "launcher/scripts/smoke-workspace.mjs", "launcher/tests/"];
const check = (id: string, cases: string[], criterion: string, modes: Mode[], fixture = false, dependencies = runtime): AcceptanceCheck => ({
  id, cases, criterion, modes, layers: fixture ? ["fixture"] : ["authenticated-dev", "native-package"],
  dependencies: [...dependencies, "tests/"],
});
const fixture = (id: string, cases: string[], criterion: string) => check(id, cases, criterion, ["not-applicable"], true);

// Required coverage lives in source control, never in a caller-supplied manifest.
// Composite criteria preserve the catalog's boundaries; flows may satisfy several rows.
export const ACCEPTANCE_CHECKS: AcceptanceCheck[] = [
  check("native.read-patch", ["CAP-001"], "Actual parallel native reads, apply_patch, command readback and owned file bytes; preserve tool permissions.", ["native-tools"]),
  check("native.same-cell", ["CAP-002"], "One 15-second exec, yield, wait on that exact cell, continuation and verified output in the same conversation.", ["native-tools"]),
  check("native.readonly-agents", ["CAP-003"], "Three overlapping read-only agents; actual GitHub README/license and source analysis, parent aggregation/closure, no grandchildren or file changes.", ["native-tools"]),
  check("models.routes", ["CAP-004"], "Four declared model routes perform real read/patch/readback with verified family, effort, permissions and files.", ["native-tools"]),
  check("models.picker", ["CAP-004"], "Both families and all five effort-menu positions are actually verified; unsupported choices block sending.", ["native-tools"]),
  fixture("models.contracts", ["CAP-004"], "Standard/triple budgets and catalog preservation, rejection of wrong/hidden selections, viewport/response/history regressions required by CAP-004."),
  check("accounting.sends", ["CAP-004", "CAP-005"], "Accepted model/tool-result Web sends match per-account ledger deltas; non-Web tool calls do not add sends and model families stay separate.", ["native-tools", "automatic-mcp"]),
  check("context.compaction", ["CAP-005", "CAP-009", "Q07"], "Real compaction and continuation preserve receipts, selected budgets, send spacing and queue ownership without self-deadlock.", ["native-tools", "automatic-mcp"]),
  fixture("context.file-contracts", ["CAP-004"], "UTF-8 32768-byte inline/file boundary, exact source fidelity and unchanged budgets; all owned uploads finish before Send, with integrity/count/error/cancel rejection and no inline fallback."),
  check("context.files", ["CAP-004"], "Authenticated large TXT context drives verified beginning/middle/end output and real read/patch/command continuation; smaller later envelopes use inline transport, with upload completion and owned output bytes.", ["native-tools", "automatic-mcp"]),
  fixture("accounting.recovery", ["CAP-005"], "Acknowledgement/delivery faults, consumer restart, migration and corrupt entries preserve exactly-once accounting and visible errors."),
  fixture("accounting.ui", ["CAP-005"], "Both languages/narrow UI, model/purpose aggregation and reference controls preserve actual counts and policy semantics."),
  check("license.desktop", ["CAP-006", "Q12"], "Actual isolated activation/import/renewal/restart/expiry, readable unlicensed pages, protected IPC/dispatch rejection including expiry while waiting, safe cleanup.", ["desktop"], false, ui),
  fixture("license.contracts", ["CAP-006", "Q12"], "Validity/calendar/device/signature/key/rollback boundaries, protected CLI/HTTP/IPC/MCP paths, pinned keys and read-only/cleanup exceptions."),
  check("license.native", ["CAP-006"], "Real native tool/file task under a verified valid independent DEV license.", ["native-tools"]),
  check("license.automatic-mcp", ["CAP-006"], "Real automatic MCP tool/file task under a verified valid independent DEV license.", ["automatic-mcp"]),
  check("license.manual-mcp", ["CAP-006"], "Real manual MCP tool/file task under a verified valid independent DEV license.", ["manual-mcp"]),
  { ...check("license.artifact", ["CAP-006"], "Actual candidate artifact inventory contains no private issuer/customer material; pinned production keys, unactivated startup and clean exit verified.", ["not-applicable"]), layers: ["native-package"] },
  check("diagnostics.desktop", ["CAP-008"], "Actual DEV log viewing/search/paging/copy, language/narrow display, pause/latest and persisted page sizes.", ["desktop"], false, ui),
  check("diagnostics.native-export", ["CAP-008", "Q17"], "Native save/cancel for all/24-hour/custom ranges; inspect actual ZIP, dates, manifest/checksums, redaction and fault correlation.", ["desktop"], false, ui),
  fixture("diagnostics.contracts", ["CAP-008", "Q17"], "Correlation/redaction/archive checksums, malformed/missing/oversized sources, partial collection, retention and failure reporting."),
  fixture("diagnostics.performance", ["CAP-008"], "Large-history indexing/search/cache/memory, cursor consistency/expiry, cancellation, bounded paging/DOM and page-size persistence/error fixtures."),
  check("queue.desktop", ["CAP-009", "Q14"], "Actual DEV normal/maximized/narrow controls, stable feedback, bilingual queue filters/paging/cancel/log navigation and usable scrolling. Session options match state/search across all pages, empty results expose no sessions, the first page detects arrivals, and family/Pro/effort labels support matching model searches.", ["desktop"], false, ui),
  check("queue.settings", ["CAP-009", "Q08", "Q15"], "Actual three-setting save/default draft/restart persistence/hot application, reduced capacity preserving running work/deadlines, navigation/error/stale revision behavior.", ["desktop"], false, ui),
  fixture("queue.contracts", ["CAP-009", "Q01", "Q02", "Q04", "Q05", "Q08"], "Shared capacity/fairness/selection, first-admission expiry, retries, dynamic settings and parent-child ownership under deterministic load."),
  check("queue.native-agents", ["CAP-009", "Q03", "Q04"], "One-slot native parent plus three children perform actual independent read/patch/readback, aggregate results, release/re-admit without leaks or hidden over-admission.", ["native-tools"]),
  check("queue.mcp-agents", ["CAP-009", "Q03", "Q04"], "One-slot automatic MCP parent plus three children perform actual independent read/patch/readback; parent releases its Web round and completes using all results.", ["automatic-mcp"]),
  check("queue.admission", ["CAP-009", "Q01"], "Small real multi-session workload confirms shared admission and fairness, waiting without creating pages or consuming execution timeout.", ["native-tools", "automatic-mcp"]),
  check("queue.mixed-models", ["CAP-009", "Q02"], "Real mixed models/efforts share capacity and retain the explicitly selected execution options.", ["native-tools", "automatic-mcp"]),
  check("queue.client-wait", ["CAP-009", "Q05"], "Real streaming and non-streaming client waiting limits recorded; expiry/retry does not renew deadlines or send expired work.", ["native-tools", "automatic-mcp"]),
  check("queue.send-spacing", ["CAP-009"], "Actual send timestamps respect configured spacing and waiting does not occupy execution capacity.", ["native-tools", "automatic-mcp"]),
  fixture("mcp.contracts", ["CAP-009"], "CAP-009 inventory/schema/namespace/tool-choice, round identity, atomic submission, completion fence/durable delivery/retry/cancel, canonical results and permissions contracts."),
  check("mcp.discovery", ["CAP-009"], "Actual two-round discovery preserves declared tool namespace/schema and completes tool execution and result continuation.", ["automatic-mcp"]),
  check("mcp.reply-reuse", ["CAP-009"], "Actual normal replies before/after tool results without finish_turn; reconnect has no resend and one-slot waiting parent retains conversation identity.", ["automatic-mcp"]),
  fixture("mcp.retention", ["CAP-009"], "Retained waiting conversations beyond five, independent cache bounds/expiry/cancel and rejection of empty/unfinished/late/required-tool prose replies."),
  check("mcp.manual", ["CAP-009", "Q13"], "Actual manual rounds require user send/completion confirmation, never DOM auto-send, preserve tool/file results, execution-stage deadline and truthful spacing UI.", ["manual-mcp"]),
  fixture("queue.standalone", ["CAP-009"], "Cross-process/profile ownership, authenticated transport, offline status, stopped configuration, owner loss and explicit verified recovery without replay."),
  fixture("queue.cancellation", ["CAP-009", "Q06"], "Waiting cancellation prevents dispatch; retry races do not duplicate pages/sends/releases; capacity remains occupied until physical settlement."),
  fixture("queue.network", ["CAP-009", "Q09"], "Synthetic rate-limit/network/preparation/unknown-send faults pause or fail explicitly, with bounded retries and no duplicate sends."),
  fixture("queue.owner-loss", ["CAP-009", "Q10"], "Crash/lease/owner loss preserves physical occupancy, requires explicit verified recovery and does not resurrect queues or replace an unknown live pool."),
  fixture("queue.pressure", ["CAP-009", "Q11"], "50-request/count/byte backlog protection, bounded metadata paging, observed memory and query latency; not authenticated concurrency proof."),
  fixture("queue.lifecycle", ["CAP-009", "Q16"], "Waiting/running work guards stop/update/removal and global cancellation retains physical cleanup obligations; not actual installer acceptance."),
  fixture("http.body-budget", ["CAP-010"], "Aggregate Responses/compact memory reservations, 50-request overload, byte/depth/zstd/error bounds, disconnect/terminal cleanup and unchanged passthrough bytes."),
];

export const criteriaHash = (value: AcceptanceCheck) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const catalogHash = () => createHash("sha256").update(JSON.stringify(ACCEPTANCE_CHECKS)).digest("hex");
