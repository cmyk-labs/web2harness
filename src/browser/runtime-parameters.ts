import type { CodexProviderConfig } from "../types";
import { readLauncherBrowserHostDescriptor } from "./launcher-client";

/** Capture launcher-owned settings once per request, never mutate a shared provider or live turn. */
export function withLauncherRuntimeParameters(provider: CodexProviderConfig): CodexProviderConfig {
  const web = provider.chatgptWeb;
  if (web?.runtimeParameters || web?.browserHost !== "launcher" || !web.browserHostDescriptorPath) return provider;
  const parameters = readLauncherBrowserHostDescriptor(web.browserHostDescriptorPath).runtimeParameters;
  if (!parameters) return provider; // A pre-feature launcher retains its existing defaults/configuration.
  return { ...provider, chatgptWeb: { ...web, runtimeParameters: parameters, stallTimeoutSec: parameters.stallMinutes * 60 } };
}
