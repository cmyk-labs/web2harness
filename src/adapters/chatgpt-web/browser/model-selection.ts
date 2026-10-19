import { diagnosticEvent } from "../../../diagnostics";
import { activateChatGptEffortMenu, CHATGPT_MODEL_CONTROL_SETTLE_MS, CHATGPT_UI_ACTION_TIMEOUT_MS,
  parseChatGptEffortSliderState, readChatGptModelSnapshot } from "../../../browser/session";
import type { ChatGptWebAdapterEffort, ChatGptWebModelFamily } from "../../../models/chatgpt-web-models";
import { ChatGptWebAdapterError } from "../adapter-error";

type EffortMenu = Awaited<ReturnType<typeof activateChatGptEffortMenu>>;

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
): Promise<EffortMenu> {
  try {
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
        await trigger.click({ timeout: CHATGPT_UI_ACTION_TIMEOUT_MS });
      } else if (view !== "advanced") throw familyError(family);
    } else {
      const trigger = menu.menu.locator('[role="menuitem"][aria-expanded][aria-hidden="false"]');
      if (await powerView.count() !== 0 || await trigger.count() !== 1) throw familyError(family);
      if (await trigger.getAttribute("aria-expanded", { timeout: CHATGPT_UI_ACTION_TIMEOUT_MS }) === "false") await trigger.click({ timeout: CHATGPT_UI_ACTION_TIMEOUT_MS });
    }
    await option.waitFor({ state: "visible", timeout: CHATGPT_MODEL_CONTROL_SETTLE_MS });
    await option.click({ timeout: CHATGPT_UI_ACTION_TIMEOUT_MS });
    diagnosticEvent("info", "browser.model_family_action", { modelFamily: family, outcome: "action-returned" });
    // Choosing a family returns the open picker to its slider. Keep that surface:
    // Escape followed by an immediate reopen races the outgoing menu's cleanup.
    // Activation reuses the open menu and verifies its owner before returning it.
    const selected = await activate();
    const deadline = Date.now() + 15_000;
    do {
      const current = familyOption(selected, family);
      const state = await current.evaluateAll(rows => ({ count: rows.length, checked: rows[0]?.getAttribute("aria-checked") }));
      if (state.count > 1) throw familyError(family);
      if (state.count === 1 && state.checked === "true") { diagnosticEvent("info", "browser.model_family_verified", { modelFamily: family, outcome: "verified" }); return selected; }
      await new Promise(resolve => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw familyError(family);
  } catch (cause) {
    if (cause instanceof ChatGptWebAdapterError) throw cause;
    throw familyError(family, cause);
  }
}

export function chatGptModelFamilyMatches(
  descriptions: readonly string[],
  family: ChatGptWebModelFamily,
  effort: ChatGptWebAdapterEffort,
): boolean {
  // An older Latest picker can still use 5.6 below Pro. That does not prove a GPT-6 request.
  const expectedName = family === "6" && effort === "max" ? "astra" : "sol";
  const states = descriptions.flatMap(text => {
    const match = /^(?:GPT[-\s]?)?(\d+(?:\.\d+)?)(?:\s+(Sol|Astra))?\s+([^,，]+)(?:[,，]|$)/i
      .exec(text.replace(/\s+/g, " ").trim());
    return match ? [{ version: match[1], name: match[2]?.toLowerCase(), mode: match[3]!.trim() }] : [];
  });
  return states.length > 0 && states.every(state => state.version === family
    && (!state.name || state.name === expectedName)
    && (effort === "max" ? /^Pro$/i.test(state.mode) : !/^Pro$/i.test(state.mode)));
}

export async function assertChatGptModelFamily(
  menu: EffortMenu,
  family: ChatGptWebModelFamily,
  effort: ChatGptWebAdapterEffort,
  effortIndex: number,
  settleMs = 0,
): Promise<void> {
  const deadline = Date.now() + settleMs;
  do {
    const option = familyOption(menu, family);
    const checked = await option.evaluateAll(rows => rows.length === 1 && rows[0]!.getAttribute("aria-checked") === "true");
    const snapshot = await readChatGptModelSnapshot(menu.slider);
    const state = snapshot && parseChatGptEffortSliderState(snapshot.min, snapshot.max, snapshot.value);
    if (checked && state && state.value === state.min + effortIndex
      && chatGptModelFamilyMatches(snapshot.descriptions, family, effort)) return;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  } while (true);
  throw familyError(family);
}
