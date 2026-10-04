/** Public facade: declarative models, budget policy, and account-aware routing. */
export * from "./chatgpt-web-model-types";
export * from "./chatgpt-web-context";
export * from "./chatgpt-web-model-registry";

import {
  CHATGPT_WEB_MODEL_PREFIX, CHATGPT_WEB_LUNA_BACKEND_MODEL,
  type ChatGptWebModelRoute, type ChatGptWebAutomaticModelRoute,
  type ChatGptWebAccountCapabilities, type ChatGptWebCodexEffort, type ChatGptWebAdapterEffort,
} from "./chatgpt-web-model-types";
import {
  CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE, CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE,
  CHATGPT_WEB_LUNA_MODEL_ROUTES, CHATGPT_WEB_MODEL_ROUTES,
  CHATGPT_WEB_LEGACY_LUNA_MODEL_ROUTE, CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE,
  CHATGPT_WEB_LEGACY_MODEL_ROUTES,
  CHATGPT_WEB_BUDGET_FALLBACK_ROUTES,
} from "./chatgpt-web-model-registry";
import { resolveChatGptWebContextLimits, sameChatGptWebContextLimits } from "./chatgpt-web-context";

function indexModelRoutes(): ReadonlyMap<string, ChatGptWebModelRoute> {
  const index = new Map<string, ChatGptWebModelRoute>();
  for (const route of [
    CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE,
    CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE,
    ...CHATGPT_WEB_LUNA_MODEL_ROUTES,
    ...CHATGPT_WEB_MODEL_ROUTES,
    CHATGPT_WEB_LEGACY_LUNA_MODEL_ROUTE,
    CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE,
    ...CHATGPT_WEB_LEGACY_MODEL_ROUTES,
    ...CHATGPT_WEB_BUDGET_FALLBACK_ROUTES,
  ]) {
    if (index.has(route.slug)) throw new Error(`Duplicate ChatGPT Web model: ${route.slug}`);
    index.set(route.slug, route);
  }
  for (const route of index.values()) {
    if (route.interactionMode !== "automatic") continue;
    for (const [effort, slug] of Object.entries(route.contextFallbacks ?? {})) {
      const fallback = index.get(slug);
      if (!route.supportedCodexEfforts?.includes(effort as ChatGptWebCodexEffort)
        || effort === route.codexEffort
        || !fallback || fallback.interactionMode !== "automatic"
        || fallback.backendModel !== route.backendModel || fallback.modelFamily !== route.modelFamily
        || fallback.adapterEffort !== effort || fallback.contextFallbacks) {
        throw new Error(`Invalid context fallback for ${route.slug}: ${effort} → ${slug}`);
      }
    }
  }
  return index;
}

const routesBySlug = indexModelRoutes();

function accountSupportsRoute(route: ChatGptWebModelRoute, capabilities: ChatGptWebAccountCapabilities): boolean {
  return (!route.requiresPro || capabilities.proAvailable)
    && (!route.requiresExtraHigh || capabilities.extraHighAvailable === true);
}

export function isChatGptWebModelSlug(modelId: string): boolean {
  return modelId.startsWith(CHATGPT_WEB_MODEL_PREFIX);
}

export function availableChatGptWebModelRoutes(
  capabilities: ChatGptWebAccountCapabilities,
  includeLegacy = false,
): readonly ChatGptWebModelRoute[] {
  if (capabilities.browserInteractionMode === "manual") {
    if (capabilities.experimentalContextFiles) {
      throw new Error("Zero Risk does not support Context as File");
    }
    return capabilities.zeroRiskProEnabled
      ? [CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE, CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE]
      : [CHATGPT_WEB_ZERO_RISK_MODEL_ROUTE];
  }
  if (!capabilities.solAvailable) return includeLegacy
    ? [...CHATGPT_WEB_LUNA_MODEL_ROUTES, CHATGPT_WEB_LEGACY_LUNA_MODEL_ROUTE, CHATGPT_WEB_LUNA_THINK_MODEL_ROUTE]
    : CHATGPT_WEB_LUNA_MODEL_ROUTES;
  const visible: ChatGptWebModelRoute[] = [];
  for (const route of CHATGPT_WEB_MODEL_ROUTES) {
    if (!accountSupportsRoute(route, capabilities)) continue;
    const efforts = chatGptWebRouteEfforts(route, capabilities);
    for (const [effort, slug] of Object.entries(route.contextFallbacks ?? {})) {
      const fallback = routesBySlug.get(slug)!;
      if (!efforts.includes(effort as ChatGptWebCodexEffort) && accountSupportsRoute(fallback, capabilities)) {
        visible.push({ ...fallback, legacy: false });
      }
    }
    visible.push(route);
  }
  if (!includeLegacy) return visible;
  const visibleSlugs = new Set(visible.map(route => route.slug));
  return [
    ...visible,
    ...CHATGPT_WEB_BUDGET_FALLBACK_ROUTES.filter(route => !visibleSlugs.has(route.slug) && accountSupportsRoute(route, capabilities)),
    ...CHATGPT_WEB_LEGACY_MODEL_ROUTES.filter(route => accountSupportsRoute(route, capabilities)),
  ];
}

export function chatGptWebRouteEfforts(
  route: ChatGptWebModelRoute,
  capabilities: ChatGptWebAccountCapabilities,
): readonly ChatGptWebCodexEffort[] {
  return (route.supportedCodexEfforts ?? [route.codexEffort])
    .filter(effort => {
      if (effort === "xhigh" && capabilities.extraHighAvailable !== true) return false;
      if (route.interactionMode !== "automatic" || effort === "ultra" || !route.contextFallbacks?.[effort]) return true;
      // Do not reduce the default Thinking budget to make Instant fit a shared catalog row.
      return sameChatGptWebContextLimits(
        resolveChatGptWebContextLimits(route.backendModel, route.adapterEffort, capabilities),
        resolveChatGptWebContextLimits(route.backendModel, effort, capabilities),
      );
    });
}

export function requireChatGptWebModelRoute(
  modelId: string,
  capabilities: ChatGptWebAccountCapabilities,
  reasoning?: string,
): ChatGptWebModelRoute {
  if (capabilities.browserInteractionMode === "manual" && capabilities.experimentalContextFiles) {
    throw new Error("Zero Risk does not support Context as File");
  }
  const route = routesBySlug.get(modelId);
  if (!route) throw new Error(`ChatGPT web model is not enabled: ${modelId}`);
  if (capabilities.browserInteractionMode === "manual") {
    if (route.interactionMode !== "manual") {
      throw new Error(`${route.displayName} is not available while Zero Risk is enabled`);
    }
    if (route === CHATGPT_WEB_ZERO_RISK_PRO_MODEL_ROUTE && !capabilities.zeroRiskProEnabled) {
      throw new Error(`${route.displayName} is not enabled in Zero Risk model settings`);
    }
    return route;
  }
  if (route.interactionMode === "manual") {
    throw new Error(`${route.displayName} is only available while Zero Risk is enabled`);
  }
  if (route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL) {
    if (capabilities.solAvailable) {
      throw new Error(`${route.displayName} is only available for Luna-only accounts`);
    }
    return resolveRouteEffort(route, capabilities, reasoning);
  }
  if (!capabilities.solAvailable) {
    throw new Error(`${route.displayName} is not available for this Luna-only account`);
  }
  if ((route.requiresPro && !capabilities.proAvailable)
    || (route.requiresExtraHigh && !capabilities.extraHighAvailable)) {
    throw new Error(`${route.displayName} is not available for this account`);
  }
  return resolveRouteEffort(route, capabilities, reasoning);
}

function resolveRouteEffort(
  route: ChatGptWebAutomaticModelRoute,
  capabilities: ChatGptWebAccountCapabilities,
  reasoning?: string,
): ChatGptWebAutomaticModelRoute {
  if (!route.supportedCodexEfforts) return route;
  const effort = reasoning ?? route.codexEffort;
  if (!chatGptWebRouteEfforts(route, capabilities).includes(effort as ChatGptWebCodexEffort)) {
    const fallbackSlug = route.contextFallbacks?.[effort as ChatGptWebAdapterEffort];
    const fallback = fallbackSlug ? routesBySlug.get(fallbackSlug) : undefined;
    const guidance = fallback ? `. Select ${fallback.displayName} for its separate context budget` : "";
    throw new Error(`${route.displayName} does not support effort ${JSON.stringify(effort)} for this account${guidance}`);
  }
  if (effort === route.codexEffort) return route;
  return { ...route, codexEffort: effort as ChatGptWebCodexEffort, adapterEffort: effort as ChatGptWebAdapterEffort };
}
