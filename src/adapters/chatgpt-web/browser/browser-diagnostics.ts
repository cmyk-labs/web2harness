/** Private browser diagnostics: redact captured state and bound trace retention. */

import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync, lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Locator, Page } from "playwright-core";
import { atomicWriteFile } from "../../../config";
import { diagnosticError } from "../../../diagnostics";
import {
  CHATGPT_ASSISTANT_TURN_SELECTOR,
  CHATGPT_COMPLETION_ACTION_SELECTOR,
  CHATGPT_COMPOSER_SELECTOR,
  CHATGPT_EFFORT_CONTROL_SELECTOR,
  CHATGPT_EFFORT_ITEM_SELECTOR,
  CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR,
  CHATGPT_STOP_BUTTON_SELECTOR,
  CHATGPT_SEND_BUTTON_SELECTOR,
  CHATGPT_USER_TURN_SELECTOR,
} from "../../../browser/session";
import { withChatGptBrowserObservationTimeout } from "./turn-observation";
import { chatGptModelFailureEvidence } from "./model-selection";

export function redactChatGptUiDiagnostic(value: string): string {
  return value
    .replace(/<codex_context_json>[\s\S]*?<\/codex_context_json>/gi, "<codex_context_json>[redacted]</codex_context_json>")
    .replace(/\b(turn|binding|call)_[A-Za-z0-9_-]{12,}\b/g, "$1_[redacted]");
}

const CHATGPT_DIAGNOSTIC_SAFE_STRING_KEYS = new Set([
  "tag",
  "role",
  "ariaExpanded",
  "ariaChecked",
  "dataState",
  "dataHighlighted",
  "origin",
]);

/** Defense in depth: persisted browser traces contain structure, never rendered UI text. */
export function sanitizeChatGptBrowserDiagnosticState(value: unknown): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(sanitizeChatGptBrowserDiagnosticState);
  if (!value || typeof value !== "object") return undefined;
  return Object.fromEntries(Object.entries(value).flatMap(([key, candidate]) => {
    if (typeof candidate === "string") {
      return CHATGPT_DIAGNOSTIC_SAFE_STRING_KEYS.has(key) && candidate.length <= 200
        ? [[key, candidate]]
        : [];
    }
    const sanitized = sanitizeChatGptBrowserDiagnosticState(candidate);
    return sanitized === undefined ? [] : [[key, sanitized]];
  }));
}

const CHATGPT_BROWSER_DIAGNOSTIC_TRACE_LIMIT = 10;
const RESPONSE_EVIDENCE_SLOTS = 64;
const RESPONSE_EVIDENCE_MAX_BYTES = 4 * 1024 * 1024;

export class ChatGptResponseEvidenceStorageError extends Error {
  constructor(readonly code: "response_evidence_too_large" | "response_evidence_archive_full") {
    super(code === "response_evidence_too_large" ? "Response evidence exceeds archive budget" : "Response evidence archive is full");
  }
}

/** Failure evidence has its own bounded archive, never the rotating screenshot pool. Exclusive
 * directory reservations work across helper processes. At capacity, stop capturing rather than
 * deleting a failure while a task is still being investigated. Existing evidence is never replaced.
 */
export function persistChatGptResponseEvidence(root: string, artifact: unknown,
  file: "response-source.private.json" | "response-dom.private.json" | "browser-failure.private.json" | "response-delivery.private.json" = "response-source.private.json"): string {
  const serialized = JSON.stringify(artifact);
  if (Buffer.byteLength(serialized) > RESPONSE_EVIDENCE_MAX_BYTES) throw new ChatGptResponseEvidenceStorageError("response_evidence_too_large");
  privateDirectory(root);
  const canonicalRoot = realpathSync(root);
  for (let slot = 0; slot < RESPONSE_EVIDENCE_SLOTS; slot++) {
    // Opt-in successful deliveries never consume or replace the failure archive.
    const name = `${file === "response-delivery.private.json" ? "response-delivery" : "response-source"}-${String(slot).padStart(2, "0")}`;
    const directory = join(canonicalRoot, name);
    try { mkdirSync(directory, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") continue; throw error; }
    // This newly created reservation is task-owned; do not follow an externally replaced link.
    if (lstatSync(directory).isSymbolicLink() || dirname(realpathSync(directory)) !== canonicalRoot) {
      throw new Error("Response evidence ownership changed");
    }
    atomicWriteFile(join(directory, file), serialized);
    return `${name}/${file}`;
  }
  throw new ChatGptResponseEvidenceStorageError("response_evidence_archive_full");
}

export function browserDiagnosticCheckpoint(value: string): string {
  const safe = value.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return safe || "checkpoint";
}

function privateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  try { chmodSync(path, 0o700); } catch { /* Windows ACLs are managed by the installer. */ }
}

export function pruneBrowserDiagnostics(root: string): void {
  const canonicalRoot = realpathSync(root);
  const traces = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && !entry.isSymbolicLink()
      && !entry.name.startsWith("response-source-")
      && !entry.name.startsWith("response-delivery-")
      && /^[A-Za-z0-9_-]{6,128}-[a-f0-9]{8}$/.test(entry.name))
    .map(entry => {
      const path = join(root, entry.name);
      return { path, modifiedAt: statSync(path).mtimeMs };
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const trace of traces.slice(CHATGPT_BROWSER_DIAGNOSTIC_TRACE_LIMIT)) {
    if (lstatSync(trace.path).isSymbolicLink() || dirname(realpathSync(trace.path)) !== canonicalRoot
      || dirname(resolve(trace.path)) !== resolve(root)) continue;
    rmSync(trace.path, { recursive: true, force: true });
  }
}

export class ChatGptBrowserDiagnostics {
  private readonly directory: string;
  private sequence = 0;
  private initialized = false;

  constructor(
    private readonly traceId: string,
    private readonly root: string,
    private readonly appName: string,
  ) {
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(traceId)) {
      throw new Error("ChatGPT browser diagnostic trace id is invalid");
    }
    this.directory = join(this.root, `${traceId}-${randomUUID().slice(0, 8)}`);
  }

  async capture(page: Page, checkpoint: string, error?: unknown): Promise<void> {
    try {
      if (!this.initialized) {
        privateDirectory(this.root);
        privateDirectory(this.directory);
        pruneBrowserDiagnostics(this.root);
        this.initialized = true;
      }
      const sequence = String(++this.sequence).padStart(2, "0");
      const stem = `${sequence}-${browserDiagnosticCheckpoint(checkpoint)}`;
      const includeScreenshot = process.env.WEB2HARNESS_BROWSER_DIAGNOSTICS === "1";
      const [screenshotResult, stateResult] = await Promise.allSettled([
        includeScreenshot
          ? page.screenshot({ animations: "disabled", caret: "hide", timeout: 5_000, type: "png" })
          : Promise.resolve(undefined),
        withChatGptBrowserObservationTimeout(page.evaluate(({
          composerSelector,
          effortControlSelector,
          effortItemSelector,
          effortSliderContainerSelector,
          assistantTurnSelector,
          userTurnSelector,
          stopButtonSelector,
          sendButtonSelector,
          completionActionSelector,
          appName,
        }) => {
          const rendered = (element: Element): boolean => {
            const candidate = element as HTMLElement;
            const style = getComputedStyle(candidate);
            return candidate.isConnected
              && style.display !== "none"
              && style.visibility !== "hidden"
              && style.opacity !== "0";
          };

          const rows = (selector: string, limit = 40) => [...document.querySelectorAll(selector)]
            .filter(rendered)
            .slice(-limit)
            .map(element => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute("role"),
                ariaExpanded: element.getAttribute("aria-expanded"),
                ariaChecked: element.getAttribute("aria-checked"),
                dataState: element.getAttribute("data-state"),
                dataHighlighted: element.getAttribute("data-highlighted"),
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                textChars: (element.textContent ?? "").length,
              };
            });
          const exactText = (element: Element, expected: string): boolean => (
            [element, ...element.querySelectorAll("*")].some(candidate => (
              candidate.children.length === 0
              && (candidate.textContent ?? "").replace(/\s+/g, " ").trim() === expected
            ))
          );
          const composers = [...document.querySelectorAll(composerSelector)].filter(rendered);
          const assistantTurns = [...document.querySelectorAll(assistantTurnSelector)].filter(rendered);
          const selectedConnectors = composers.flatMap(composer => (
            [...composer.querySelectorAll('[data-id^="plugin:"][data-keyword], [app-mention-path^="app://"][app-mention-display-name][contenteditable="false"], [plugin-mention-path^="plugin://"][plugin-mention-display-name][contenteditable="false"]')]
          ))
            .filter(rendered);
          const exactConnectorRows = [...document.querySelectorAll('.__menu-item[tabindex="0"], [data-mention-list-scroll-area] button[data-list-navigation-item="true"]')]
            .filter(element => rendered(element) && exactText(element, appName));
          const currentUrl = new URL(location.href);
          const integerAttribute = (element: Element, name: string): number | null => {
            const raw = element.getAttribute(name);
            return raw !== null && /^-?\d+$/.test(raw) && Number.isSafeInteger(Number(raw))
              ? Number(raw) : null;
          };
          return {
            location: {
              origin: currentUrl.origin,
              pathSegments: currentUrl.pathname.split("/").filter(Boolean).length,
              temporaryChat: currentUrl.searchParams.has("temporary-chat"),
            },
            titleChars: document.title.length,
            documentComplete: document.readyState === "complete",
            viewport: { width: innerWidth, height: innerHeight },
            visibility: { hidden: document.hidden, focused: document.hasFocus() },
            sendControls: composers.flatMap(composer => [...(composer.closest("form")?.querySelectorAll(sendButtonSelector) ?? [])])
              .slice(0, 4).map(element => {
                const rect = element.getBoundingClientRect();
                const x = Math.max(0, rect.left) + (Math.min(innerWidth, rect.right) - Math.max(0, rect.left)) / 2;
                const y = Math.max(0, rect.top) + (Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top)) / 2;
                const inViewport = rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0
                  && rect.left < innerWidth && rect.top < innerHeight;
                const hit = inViewport ? document.elementFromPoint(x, y) : null;
                return { connected: element.isConnected, rendered: rendered(element),
                  enabled: !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true",
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, inViewport,
                  receivesPointer: !!hit && (element === hit || element.contains(hit)) };
              }),
            surfaceBound: typeof (globalThis as typeof globalThis & { __WEB2HARNESS_SURFACE_ID__?: unknown })
              .__WEB2HARNESS_SURFACE_ID__ === "string",
            // textContent avoids the synchronous layout forced by innerText on huge prompts.
            bodyTextChars: document.body?.textContent?.length ?? 0,
            composer: {
              visibleCount: composers.length,
              textChars: composers.map(element => (
                element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement
                  ? element.value : element.textContent ?? ""
              ).length),
              editors: composers.map(element => {
                const textarea = element instanceof HTMLTextAreaElement ? element : undefined;
                const selection = element.ownerDocument.defaultView?.getSelection();
                return {
                  tag: element.tagName.toLowerCase(),
                  connected: element.isConnected,
                  contentEditable: (element as HTMLElement).isContentEditable,
                  readOnly: textarea ? textarea.readOnly : element.getAttribute("aria-readonly") === "true",
                  disabled: textarea ? textarea.matches(":disabled") : element.getAttribute("aria-disabled") === "true",
                  focused: element === document.activeElement,
                  caret: textarea ? {
                    available: textarea.selectionStart !== null && textarea.selectionEnd !== null,
                    collapsed: textarea.selectionStart !== null && textarea.selectionStart === textarea.selectionEnd,
                  } : {
                    available: Boolean(selection),
                    rangeCount: selection?.rangeCount ?? 0,
                    collapsed: selection?.isCollapsed ?? false,
                    anchorInside: Boolean(selection?.anchorNode && element.contains(selection.anchorNode)),
                    focusInside: Boolean(selection?.focusNode && element.contains(selection.focusNode)),
                  },
                };
              }),
              // When recognition fails, retain structure of the unmatched controls,
              // never their values, labels, HTML or other conversation contents.
              unrecognizedEditors: composers.length === 0
                ? [...document.querySelectorAll('textarea, [contenteditable="true"]')]
                  .filter(rendered).slice(0, 10).map(element => ({
                    tag: element.tagName.toLowerCase(),
                    role: element.getAttribute("role"),
                    attributes: Object.fromEntries([
                      "id", "data-testid", "data-lexical-editor", "data-composer-markdown",
                      "contenteditable", "placeholder", "autofocus", "disabled", "readonly",
                    ].map(name => [name, element.hasAttribute(name)])),
                    inForm: Boolean(element.closest("form")),
                    inComposerForm: Boolean(element.closest("form[data-chatgpt-composer]")),
                    focused: element === document.activeElement,
                  }))
                : [],
              selectedConnectorCount: selectedConnectors.length,
              exactSelectedConnectorCount: selectedConnectors.filter(
                element => (element.getAttribute("data-keyword") ?? element.getAttribute("app-mention-display-name")
                  ?? element.getAttribute("plugin-mention-display-name")) === appName,
              ).length,
            },
            focus: {
              tag: document.activeElement?.tagName.toLowerCase() ?? null,
              role: document.activeElement?.getAttribute("role") ?? null,
              documentFocused: document.hasFocus(),
            },
            effortControls: rows(effortControlSelector, 10),
            effortItems: rows(effortItemSelector, 20),
            effortSliders: [...document.querySelectorAll(effortSliderContainerSelector)]
              .filter(rendered).slice(-10)
              .flatMap(container => [...container.querySelectorAll('[role="slider"]')].map(element => ({
                min: integerAttribute(element, "aria-valuemin"),
                max: integerAttribute(element, "aria-valuemax"),
                value: integerAttribute(element, "aria-valuenow"),
                power: container.hasAttribute("data-model-picker-power-slider"),
                enabled: Boolean(container.querySelector('[data-orientation="horizontal"][aria-disabled="false"]')),
                ticks: [...container.querySelectorAll("[data-selected]")].slice(0, 10).map(tick => ({
                  locked: tick.getAttribute("data-locked") === "true" ? true
                    : tick.getAttribute("data-locked") === "false" ? false : null,
                })),
              }))),
            menus: rows('[role="menu"], [role="listbox"], [data-testid="composer-intelligence-picker-content"]', 20),
            connectorRows: exactConnectorRows.slice(-20).map(element => {
              const rect = element.getBoundingClientRect();
              return {
                tag: element.tagName.toLowerCase(),
                role: element.getAttribute("role"),
                dataState: element.getAttribute("data-state"),
                dataHighlighted: element.getAttribute("data-highlighted"),
                rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                textChars: (element.textContent ?? "").length,
              };
            }),
            overlays: rows('[role="dialog"], [role="alert"], [role="status"]', 30),
            turns: {
              user: document.querySelectorAll(userTurnSelector).length,
              stopButtonCount: [...document.querySelectorAll(stopButtonSelector)].filter(rendered).length,
              assistant: assistantTurns.map(element => ({
                textChars: (element.textContent ?? "").length,
                htmlChars: (element as HTMLElement).innerHTML.length,
                markdownCount: element.querySelectorAll('.markdown, [data-markdown-text-style="assistant-message"]').length,
                streamingStatusCount: element.querySelectorAll("[data-streaming-response-status]").length,
                completionActionCount: element.querySelectorAll(completionActionSelector).length,
                renderedCompletionActionCount: [...element.querySelectorAll(completionActionSelector)]
                  .filter(rendered).length,
              })),
            },
          };
        }, {
          composerSelector: CHATGPT_COMPOSER_SELECTOR,
          effortControlSelector: CHATGPT_EFFORT_CONTROL_SELECTOR,
          effortItemSelector: CHATGPT_EFFORT_ITEM_SELECTOR,
          effortSliderContainerSelector: CHATGPT_EFFORT_SLIDER_CONTAINER_SELECTOR,
          assistantTurnSelector: CHATGPT_ASSISTANT_TURN_SELECTOR,
          userTurnSelector: CHATGPT_USER_TURN_SELECTOR,
          stopButtonSelector: CHATGPT_STOP_BUTTON_SELECTOR,
          sendButtonSelector: CHATGPT_SEND_BUTTON_SELECTOR,
          completionActionSelector: CHATGPT_COMPLETION_ACTION_SELECTOR,
          appName: this.appName,
        })),
      ]);
      const capturedAt = new Date().toISOString();
      if (screenshotResult.status === "fulfilled" && screenshotResult.value) {
        atomicWriteFile(join(this.directory, `${stem}.png`), screenshotResult.value);
      }
      const captureErrors = Object.fromEntries([
        ...(screenshotResult.status === "rejected" ? [[
          "screenshot",
          redactChatGptUiDiagnostic(
            screenshotResult.reason instanceof Error ? screenshotResult.reason.message : String(screenshotResult.reason),
          ),
        ]] : []),
        ...(stateResult.status === "rejected" ? [[
          "state",
          redactChatGptUiDiagnostic(
            stateResult.reason instanceof Error ? stateResult.reason.message : String(stateResult.reason),
          ),
        ]] : []),
      ]);
      const artifact = {
        version: 2,
        capturedAt,
        traceId: this.traceId,
        checkpoint,
        ...(error !== undefined ? {
          error: redactChatGptUiDiagnostic(error instanceof Error ? error.message : String(error)),
        } : {}),
        ...(stateResult.status === "fulfilled"
          ? { state: sanitizeChatGptBrowserDiagnosticState(stateResult.value) }
          : {}),
        ...(Object.keys(captureErrors).length > 0 ? { captureErrors } : {}),
      };
      atomicWriteFile(join(this.directory, `${stem}.json`), `${JSON.stringify(artifact, null, 2)}\n`);
      if (error !== undefined && diagnosticError(error).category !== "cancelled") {
        const modelVerification = chatGptModelFailureEvidence(error);
        const reference = persistChatGptResponseEvidence(this.root,
          { ...artifact, ...(modelVerification ? { modelVerification } : {}) }, "browser-failure.private.json");
        console.info(`[chatgpt-web] browser failure retained trace=${this.traceId} reference=${reference}`);
      }
      if (Object.keys(captureErrors).length > 0) {
        console.warn(
          `[chatgpt-web] browser diagnostic partial capture trace=${this.traceId}`
          + ` checkpoint=${stem} failures=${Object.keys(captureErrors).join(",")}`,
        );
      }
      console.info(`[chatgpt-web] browser diagnostic trace=${this.traceId} checkpoint=${stem} path=${this.directory}`);
    } catch (captureError) {
      console.warn(
        `[chatgpt-web] browser diagnostic capture failed trace=${this.traceId}`
        + ` checkpoint=${browserDiagnosticCheckpoint(checkpoint)}:`
        + ` ${captureError instanceof Error ? captureError.message : String(captureError)}`,
      );
    }
  }
}

export async function describeStalledChatGptTurn(page: Page, responseTurn: Locator): Promise<string> {
  const responseState = await responseTurn.count()
    ? await responseTurn.evaluate(element => {
      const root = element as HTMLElement;
      const descriptors = [...root.querySelectorAll<HTMLElement>("[role], [data-testid], button, [aria-label]")]
        .filter(candidate => {
          const style = getComputedStyle(candidate);
          return style.visibility !== "hidden" && style.display !== "none";
        })
        .slice(-80)
        .map(candidate => ({
          tag: candidate.tagName.toLowerCase(),
          role: candidate.getAttribute("role"),
          testId: candidate.getAttribute("data-testid"),
          ariaLabelChars: candidate.getAttribute("aria-label")?.length ?? 0,
          titleChars: candidate.getAttribute("title")?.length ?? 0,
          textChars: (candidate.innerText ?? candidate.textContent ?? "").trim().length,
        }));
      return {
        textChars: (root.innerText ?? root.textContent ?? "").trim().length,
        htmlChars: root.innerHTML.length,
        descriptors,
      };
    })
    : { text: "", descriptors: [] };
  const overlays = await page.locator('[role="dialog"], [role="alert"], [role="status"]').evaluateAll(elements => (
    elements
      .filter(element => {
        const candidate = element as HTMLElement;
        const style = getComputedStyle(candidate);
        return style.visibility !== "hidden" && style.display !== "none";
      })
      .slice(-30)
      .map(element => {
        const candidate = element as HTMLElement;
        return {
          role: candidate.getAttribute("role"),
          testId: candidate.getAttribute("data-testid"),
          ariaLabelChars: candidate.getAttribute("aria-label")?.length ?? 0,
          textChars: (candidate.innerText ?? candidate.textContent ?? "").trim().length,
        };
      })
  )).catch(() => [] as Array<Record<string, string | null>>);
  return redactChatGptUiDiagnostic(JSON.stringify({ response: responseState, overlays }));
}
