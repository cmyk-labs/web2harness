import type { CodexProviderConfig } from "../types";
import { readLauncherBrowserHostDescriptor } from "./launcher-client";

/** Capture launcher-owned settings once per request, never mutate a shared provider or live turn. */
export function withLauncherRuntimeParameters(provider: CodexProviderConfig): CodexProviderConfig {
  const web = provider.chatgptWeb;
  if (web?.runtimeParameters || web?.browserHost !== "launcher" || !web.browserHostDescriptorPath) return provider;
  const descriptor = readLauncherBrowserHostDescriptor(web.browserHostDescriptorPath);
  const parameters = descriptor.runtimeParameters;
  if (!parameters && !descriptor.language) return provider;
  return { ...provider, chatgptWeb: { ...web,
    ...(descriptor.language ? { uiLanguage: descriptor.language } : {}),
    ...(parameters ? { runtimeParameters: parameters, stallTimeoutSec: parameters.stallMinutes * 60 } : {}),
  } };
}
