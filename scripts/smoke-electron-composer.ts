/** Bounded, unauthenticated Electron input experiment. Evidence is retained under output/. */
import { _electron, type ElectronApplication, type Page } from 'playwright-core';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareComposerForInput, insertPlainTextIntoComposer } from '../src/adapters/chatgpt-web/browser/composer';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(repositoryRoot, 'output', '2026-10-14-retained-connector-input-repair');
mkdirSync(outputRoot, { recursive: true });
const fixtureHome = mkdtempSync(join(outputRoot, 'electron-'));
const token = randomUUID();
writeFileSync(join(fixtureHome, 'owner.json'), JSON.stringify({ purpose: 'electron-composer-input', token,
  repositoryRoot, createdAt: new Date().toISOString() }, null, 2));
for (const name of ['user-data', 'session-data']) mkdirSync(join(fixtureHome, name));
const launcherRequire = createRequire(join(repositoryRoot, 'launcher', 'package.json'));
const executablePath = launcherRequire('electron') as string;
const playwrightRoot = dirname(launcherRequire.resolve('playwright-core/package.json'));
if (!existsSync(executablePath)) throw new Error('The checked-out launcher Electron executable is unavailable');
const childEnvironment: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value !== undefined && !name.startsWith('WEB2HARNESS_')
    && name !== 'ELECTRON_RUN_AS_NODE' && name !== 'CODEX_HOME') childEnvironment[name] = value;
}
childEnvironment.WEB2HARNESS_COMPOSER_FIXTURE_HOME = fixtureHome;
const results: Array<Record<string, unknown>> = [];
let electronApp: ElectronApplication | undefined;
let failure: string | undefined;
const query = '@codex';

type Layout = { selected: string; ready?: string[]; focus?: string };
async function layout(value: Layout): Promise<void> {
  await electronApp!.evaluate((_electron, value) => {
    (globalThis as any).__composerFixture.layout(value);
  }, value);
}

async function resetEditor(page: Page): Promise<void> {
  await page.evaluate(() => {
    const element = document.getElementById('prompt-textarea')!;
    // Setup is deliberately separate from the input being measured.
    element.replaceChildren();
    const state = { events: [] as Array<Record<string, unknown>>, mutations: 0, replacements: 0 };
    (window as any).__composerTrace = state;
    if ((window as any).__composerTraceInstalled) return;
    (window as any).__composerTraceInstalled = true;
    const initialEditor = element;
    for (const type of ['keydown', 'keypress', 'keyup', 'beforeinput', 'input', 'focus', 'blur']) {
      document.addEventListener(type, event => {
        const trace = (window as any).__composerTrace;
        if (trace.events.length >= 80) return;
        const sample = { type, targetIsEditor: event.target === document.getElementById('prompt-textarea'),
          inputType: event instanceof InputEvent ? event.inputType : undefined,
          defaultPrevented: event.defaultPrevented };
        trace.events.push(sample);
        queueMicrotask(() => { sample.defaultPrevented = event.defaultPrevented; });
      }, true);
    }
    new MutationObserver(records => {
      const trace = (window as any).__composerTrace;
      trace.mutations += records.length;
      trace.replacements = document.getElementById('prompt-textarea') === initialEditor ? 0 : 1;
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
}

try {
  electronApp = await _electron.launch({
    executablePath,
    args: ['-r', join(playwrightRoot, 'lib/server/electron/loader.js'),
      join(repositoryRoot, 'tests/adapters/chatgpt-web/browser/fixtures/electron-composer.cjs')],
    env: childEnvironment, timeout: 20_000,
  });
  const launchedArguments = electronApp.process().spawnargs;
  if (launchedArguments.some(value => value === '--no-sandbox')) {
    throw new Error('This fixture requires Electron sandbox enforcement');
  }
  const ownership = await electronApp.evaluate(async () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if ((globalThis as any).__composerFixtureReady) return await (globalThis as any).__composerFixtureReady;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('Fixture did not initialize');
  });
  // Playwright launches through a shell on Windows; the inspected app is its child.
  // This handle came from that launch's private inspector, and must echo the fresh owner token.
  if (ownership.token !== token || !Number.isSafeInteger(ownership.processId) || ownership.processId < 1) {
    throw new Error('Fixture process ownership did not match');
  }
  const pages = new Map<string, Page>();
  for (const page of electronApp.context().pages()) {
    const title = await page.title();
    if (/^composer-fixture-(parent|child-1|child-2)$/.test(title)) pages.set(title.slice('composer-fixture-'.length), page);
  }
  const parent = pages.get('parent');
  if (!parent || pages.size !== 3) throw new Error('Expected three owned fixture views');
  parent.setDefaultTimeout(5_000);
  const composer = parent.locator('#prompt-textarea');
  const scenarios = ['selected', 'offscreen', 'retained-resume', 'focus-switch-after-prepare'] as const;
  for (const scenario of scenarios) {
    for (const method of ['native', 'dom'] as const) {
      await layout({ selected: 'parent', focus: 'parent' });
      await resetEditor(parent);
      if (scenario === 'retained-resume') {
        await layout({ selected: 'child-1', ready: ['parent'], focus: 'child-1' });
        await new Promise(resolve => setTimeout(resolve, 60));
      }
      if (scenario === 'offscreen' || scenario === 'retained-resume') {
        await layout({ selected: 'child-1', focus: 'child-1' });
      }
      await electronApp.evaluate(() => (globalThis as any).__composerFixture.resetNativeEvents());
      let accepted: boolean | undefined;
      let inputError: string | undefined;
      try {
        if (method === 'native') {
          accepted = await composer.evaluate(prepareComposerForInput, undefined);
          if (scenario === 'focus-switch-after-prepare') {
            await layout({ selected: 'child-1', focus: 'child-1' });
          }
          if (accepted) await composer.pressSequentially(query, { delay: 25, timeout: 5_000 });
        } else {
          if (scenario === 'focus-switch-after-prepare') {
            await layout({ selected: 'child-1', focus: 'child-1' });
          }
          accepted = await composer.evaluate(insertPlainTextIntoComposer, query);
        }
      } catch (error) { inputError = error instanceof Error ? error.message : String(error); }
      const observed = await parent.evaluate(expected => {
        const element = document.getElementById('prompt-textarea')!;
        const text = element.textContent ?? '';
        const selection = window.getSelection();
        return { exact: text === expected, actualChars: text.length,
          focused: document.activeElement === element, documentFocused: document.hasFocus(),
          caretInside: !!selection?.anchorNode && element.contains(selection.anchorNode),
          width: innerWidth, height: innerHeight, visibility: document.visibilityState,
          trace: (window as any).__composerTrace };
      }, query);
      const native = await electronApp.evaluate(() => (globalThis as any).__composerFixture.snapshot());
      results.push({ scenario, method, accepted, inputError, observed, native });
    }
  }
  if (results.length !== 8 || results.some(result => result.inputError
    || !(result.observed as { exact: boolean }).exact)) {
    throw new Error('At least one isolated input scenario did not preserve the complete mention');
  }
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (electronApp) {
    try { await electronApp.close(); }
    catch (error) { failure = (failure ?? '') + '\nFixture close failed: ' + String(error); process.exitCode = 1; }
  }
  const evidencePath = join(fixtureHome, 'input-results.json');
  writeFileSync(evidencePath, JSON.stringify({ kind: 'unauthenticated-electron-fixture', token, results, failure }, null, 2));
  console.log(JSON.stringify({ evidencePath, completed: results.length, failure,
    observations: results.map(result => ({ scenario: result.scenario, method: result.method,
      accepted: result.accepted, inputError: result.inputError, observed: result.observed })) }));
}

