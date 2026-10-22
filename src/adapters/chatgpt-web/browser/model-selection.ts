import { diagnosticEvent } from "../../../diagnostics";
import { activateChatGptEffortMenu, CHATGPT_MODEL_CONTROL_SETTLE_MS, CHATGPT_UI_ACTION_TIMEOUT_MS,
  parseChatGptEffortSliderState, readChatGptModelSnapshot } from "../../../browser/session";
import type { ChatGptWebAdapterEffort, ChatGptWebModelFamily } from "../../../models/chatgpt-web-models";
import { ChatGptWebAdapterError } from "../adapter-error";
import { ChatGptModelMenuObservationUnavailableError } from "./model-menu-recovery";

type EffortMenu = Awaited<ReturnType<typeof activateChatGptEffortMenu>>;
type ModelSnapshot = NonNullable<Awaited<ReturnType<typeof readChatGptModelSnapshot>>>;
type PrivateModelEvidence = { version: 1; modelFamily: ChatGptWebModelFamily; requestedEffort: ChatGptWebAdapterEffort;
  reason: string; checks: Record<string, unknown>; sampledAttempt: number; terminalAttempt: number;
  descriptions: ModelSnapshot["descriptionEvidence"]; omittedDescriptions: number };
// Keep raw control samples out of Error properties, JSON responses and ordinary logs.
// The existing failure archive is the sole consumer; GC releases completed failures.
const privateModelEvidence = new WeakMap<Error, PrivateModelEvidence>();
export function chatGptModelFailureEvidence(error: unknown): PrivateModelEvidence | undefined {
  return error instanceof Error ? privateModelEvidence.get(error) : undefined;
}

function familyError(family: ChatGptWebModelFamily, cause?: unknown): ChatGptWebAdapterError {
  return new ChatGptWebAdapterError(
    `ChatGPT model ${family} could not be selected and verified. The pending message was not sent. Check the model in the browser; if ChatGPT uses an unsupported language, select English in Settings → General → Language and reload it.`,
    { status: 400, errorType: "invalid_request_error", code: "model_version_unavailable", retryable: false, cause },
  );
}

function familyOption(menu: EffortMenu, family: ChatGptWebModelFamily) {
  return menu.menu.getByRole("menuitemradio", {
    name: family === "5.6" ? /^GPT[-\s]?5\.6\s+Sol(?:\s+Pro)?$/i
      // Simplified/Traditional Chinese and Japanese share 最新; Korean uses 최신.
      : /^(?:Latest|最新|최신|(?:GPT[-\s]?)?6(?:\s+Astra)?(?:\s+Pro)?)$/i,
    exact: true,
    includeHidden: true,
  });
}

/** Model and effort are separate browser controls; a generic Pro label proves neither family. */
export async function selectChatGptModelFamily(
  menu: EffortMenu,
  family: ChatGptWebModelFamily,
  activate: () => Promise<EffortMenu>,
  signal?: AbortSignal,
): Promise<EffortMenu> {
  try {
    signal?.throwIfAborted();
    const option = familyOption(menu, family);
    if (await option.count() > 1) throw familyError(family);
    if (await option.count() === 1 && await option.getAttribute("aria-checked", { timeout: CHATGPT_UI_ACTION_TIMEOUT_MS }) === "true") { diagnosticEvent("info", "browser.model_family_verified", { modelFamily: family, outcome: "already-selected" }); return menu; }
    // The attached radio rows are inert while this composer-owned advanced view is collapsed.
    const powerView = menu.menu.locator('[data-model-picker-view]');
    if (await powerView.count() === 1) {
      const view = await powerView.getAttribute("data-model-picker-view", { timeout: CHATGPT_UI_ACTION_TIMEOUT_MS });
      if (view === "simple") {
        // Current pickers put aria-hidden on the view track, not on the toggle.
        const trigger = powerView.locator('[data-model-picker-view-toggle="true"]:not([hidden], [inert], [aria-hidden="true"], [hidden] *, [inert] *, [aria-hidden="true"] *)')
          .filter({ visible: true });
        if (await trigger.count() !== 1) throw familyError(family);
        signal?.throwIfAborted();
        await trigger.click({ timeout: CHATGPT_UI_ACTION_TIMEOUT_MS, signal });
      } else if (view !== "advanced") throw familyError(family);
    } else {
      const trigger = menu.menu.locator('[role="menuitem"][aria-expanded][aria-hidden="false"]');
      if (await powerView.count() !== 0 || await trigger.count() !== 1) throw familyError(family);
      if (await trigger.getAttribute("aria-expanded", { timeout: CHATGPT_UI_ACTION_TIMEOUT_MS }) === "false") {
        signal?.throwIfAborted();
        await trigger.click({ timeout: CHATGPT_UI_ACTION_TIMEOUT_MS, signal });
      }
    }
    await option.waitFor({ state: "visible", timeout: CHATGPT_MODEL_CONTROL_SETTLE_MS, signal });
    signal?.throwIfAborted();
    await option.click({ timeout: CHATGPT_UI_ACTION_TIMEOUT_MS, signal });
    diagnosticEvent("info", "browser.model_family_action", { modelFamily: family, outcome: "action-returned" });
    // Choosing a family returns the open picker to its slider. Keep that surface:
    // Escape followed by an immediate reopen races the outgoing menu's cleanup.
    // Activation reuses the open menu and verifies its owner before returning it.
    const selected = await activate();
    const deadline = Date.now() + 15_000;
    do {
      signal?.throwIfAborted();
      const current = familyOption(selected, family);
      const state = await current.evaluateAll(rows => ({ count: rows.length, checked: rows[0]?.getAttribute("aria-checked") }));
      if (state.count > 1) throw familyError(family);
      if (state.count === 1 && state.checked === "true") { diagnosticEvent("info", "browser.model_family_verified", { modelFamily: family, outcome: "verified" }); return selected; }
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw familyError(family);
  } catch (cause) {
    signal?.throwIfAborted();
    if (cause instanceof ChatGptWebAdapterError) throw cause;
    throw familyError(family, cause);
  }
}

export function chatGptModelFamilyMatches(
  descriptions: readonly string[],
  family: ChatGptWebModelFamily,
  effort: ChatGptWebAdapterEffort,
): boolean {
  const states = modelDescriptionChecks(descriptions, family, effort).filter(state => state.recognized);
  return states.length > 0 && states.every(state => state.familyMatches && state.nameMatches && state.effortMatches);
}

/** Record predicates, never arbitrary picker text (which can contain account/page content). */
function modelDescriptionChecks(descriptions: readonly string[], family: ChatGptWebModelFamily, effort: ChatGptWebAdapterEffort) {
  // An older Latest picker can still use 5.6 below Pro. That does not prove a GPT-6 request.
  const expectedName = family === "6" && effort === "max" ? "astra" : "sol";
  // Adapted from miuuyy/codex-chatgpt-web 6f43747 (MIT): require the exact effort,
  // and normalize only an identical version repeated across separate header labels.
  const expectedMode = { low: "instant", medium: "medium", high: "high", xhigh: "extra high", max: "pro" }[effort];
  return descriptions.map(text => {
    const normalized = text.normalize("NFKC").replace(/\p{Cf}/gu, "").replace(/\s+/g, " ").trim()
      .replace(/^((?:GPT[-\s]?)?(\d+(?:\.\d+)?)\s+(?:Sol|Astra))\s+(?:GPT[-\s]?)?\2\s+/i, "$1 ");
    const match = /^(?:GPT[-\s]?)?(\d+(?:\.\d+)?)(?:\s+(Sol|Astra))?\s+([^\p{P}]+)(?:\p{P}|$)/iu.exec(normalized);
    return { recognized: !!match, familyMatches: match?.[1] === family,
      modelFamily: match?.[1] === "6" || match?.[1] === "5.6" ? match[1] : "unknown",
      model: ["sol", "astra"].includes(match?.[2]?.toLowerCase() ?? "") ? match![2]!.toLowerCase() : "unknown",
      effort: ["instant", "medium", "high", "extra high", "pro"].includes(match?.[3]?.trim().toLowerCase() ?? "") ? match![3]!.trim().toLowerCase() : "unknown",
      nameMatches: !!match && (!match[2] || match[2].toLowerCase() === expectedName),
      effortMatches: match?.[3]?.trim().toLowerCase() === expectedMode };
  });
}

export async function assertChatGptModelFamily(
  menu: EffortMenu,
  family: ChatGptWebModelFamily,
  effort: ChatGptWebAdapterEffort,
  effortIndex: number,
  settleMs = 0,
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + settleMs;
  let checks: Record<string, unknown> = {};
  let stage = "family_radio";
  let attempts = 0;
  const started = performance.now();
  const history: Record<string, unknown>[] = [];
  let lastState = "", droppedStates = 0;
  let sawReadableMismatch = false;
  let menuObservationMissing = false;
  let lastReadable: { snapshot: ModelSnapshot; checks: Record<string, unknown>; attempt: number } | undefined;
  let reason = "selection_mismatch";
  const observe = () => {
    const state = JSON.stringify({ stage, checks });
    if (state === lastState) return;
    lastState = state;
    const entry = { stage, checks, elapsedMs: Math.round(performance.now() - started), attempts };
    // Retain the first observation and latest 31 changes. Report loss explicitly.
    if (history.length >= 32) { history.splice(1, 1); droppedStates++; }
    history.push(entry);
    diagnosticEvent("info", "browser.model_verification_state", { modelFamily: family, requestedEffort: effort, ...entry });
  };
  try {
    do {
      signal?.throwIfAborted();
      attempts++;
      stage = "family_radio";
      const option = familyOption(menu, family);
      const radio = await option.evaluateAll(rows => ({ count: rows.length,
        checked: rows.length === 1 && rows[0]!.getAttribute("aria-checked") === "true" }));
      checks = { radio };
      stage = "model_snapshot";
      const snapshot = await readChatGptModelSnapshot(menu.slider);
      const state = snapshot && parseChatGptEffortSliderState(snapshot.min, snapshot.max, snapshot.value);
      const sliderMatches = !!state && state.value === state.min + effortIndex;
      const descriptions = modelDescriptionChecks(snapshot?.descriptions ?? [], family, effort)
        .map((description, index) => ({ ...description, source: snapshot?.descriptionSources?.[index] ?? "unknown" }));
      const recognized = descriptions.filter(description => description.recognized);
      const descriptionsMatch = recognized.length > 0 && recognized.every(description =>
        description.familyMatches && description.nameMatches && description.effortMatches);
      // An unrecognized description is uncertainty, not proof of another selection.
      // This only improves diagnosis: the acceptance predicates remain unchanged.
      reason = !snapshot ? "observation_failed" : radio.checked && sliderMatches && !descriptionsMatch
        && !recognized.some(description => !description.familyMatches || !description.nameMatches
          || description.effort !== "unknown" && !description.effortMatches)
        ? "description_unknown" : "selection_mismatch";
      checks = { radio, snapshotPresent: !!snapshot, sliderValid: !!state,
        ...(snapshot ? { controlId: snapshot.controlId, headerCount: snapshot.headerCount, connected: snapshot.connected, visible: snapshot.visible, busy: snapshot.busy } : {}),
        ...(snapshot?.relationships ? { relationships: snapshot.relationships } : {}),
        ...(snapshot?.descriptionEvidence ? { descriptionNodes: snapshot.descriptionEvidence.map(({ text, reference, ...structure }) => structure) } : {}),
        ...(state ? { slider: { ...state, target: state.min + effortIndex } } : {}),
        sliderMatches, descriptions: descriptions.slice(0, 8), descriptionCount: descriptions.length,
        omittedDescriptions: Math.max(0, descriptions.length - 8), descriptionsMatch };
      if (snapshot) lastReadable = { snapshot, checks, attempt: attempts };
      observe();
      if (radio.checked && sliderMatches && descriptionsMatch) return;
      if (snapshot && radio.count > 0) sawReadableMismatch = true;
      menuObservationMissing = !snapshot;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (true);
  } catch (error) {
    observe();
    diagnosticEvent("warning", "browser.model_verification_failed", { modelFamily: family, requestedEffort: effort,
      stage, reason: "observation_failed", attempts, checks, history, droppedStates, submission: "not-sent" });
    throw error;
  }
  if (menuObservationMissing && !sawReadableMismatch) {
    diagnosticEvent("warning", "browser.model_verification_failed", { modelFamily: family, requestedEffort: effort,
      stage, reason: "observation_failed", attempts, checks, history, droppedStates, submission: "not-sent" });
    throw new ChatGptModelMenuObservationUnavailableError("ChatGPT model menu disappeared before its selection could be read");
  }
  diagnosticEvent("warning", "browser.model_verification_failed", { modelFamily: family, requestedEffort: effort,
    stage: "selection_confirmation", reason, attempts, checks, history, droppedStates, submission: "not-sent" });
  const failure = familyError(family);
  if (lastReadable) privateModelEvidence.set(failure, { version: 1, modelFamily: family, requestedEffort: effort,
    reason, checks: lastReadable.checks, sampledAttempt: lastReadable.attempt, terminalAttempt: attempts,
    descriptions: lastReadable.snapshot.descriptionEvidence ?? [],
    omittedDescriptions: Math.max(0, lastReadable.snapshot.descriptions.length - (lastReadable.snapshot.descriptionEvidence?.length ?? 0)) });
  throw failure;
}
