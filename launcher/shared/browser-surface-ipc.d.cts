export const BROWSER_SURFACE_ACTIVE_CHANNEL: "launcher:browser-surface-active";
export type BrowserSurfaceActiveRequest = boolean;
/** No browser has been constructed yet during shell startup. */
export type BrowserSurfaceActiveResult<State> = State | null;
export function validateBrowserSurfaceActive(value: unknown): BrowserSurfaceActiveRequest;
