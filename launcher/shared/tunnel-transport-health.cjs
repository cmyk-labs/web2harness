const INTERNAL_FAILURE_RECENCY_MS = 2 * 60_000;

// Read observations from the current process only. /readyz is a startup gate;
// it stays green even when the control plane rejects every poll with HTTP 401.
function parseTunnelTransportHealth(events, metrics, now = Date.now()) {
  if (!Array.isArray(events)) throw new Error("response has no events array");
  const samples = [...metrics.matchAll(/^commands_poll_last_successful_timestamp_seconds(?:\{[^\r\n]*\})?\s+([\d.eE+-]+)\s*$/gm)];
  const lastSuccess = samples.length === 1 ? Number(samples[0][1]) * 1000 : NaN;
  const failures = events.filter(event => {
    const at = Date.parse(event?.time);
    return Number.isFinite(at) && at <= now + 5_000;
  }).sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
  const auth = failures.find(event => event.message === "poll failed; backing off"
    && [401, 403].includes(event.attrs?.status_code)
    // A completed success after the failure supersedes it. Never clear a rejected
    // credential merely because a timeout passed.
    && !(lastSuccess > Date.parse(event.time)));
  if (auth) {
    const forbidden = auth.attrs.status_code === 403;
    return { observed: true, ok: false, fatal: true, retryable: false,
      code: forbidden ? "tunnel_permission_denied" : "tunnel_authentication_failed",
      detail: forbidden
        ? "Tunnel polling returned HTTP 403: verify the runtime key's Tunnels Read + Use permissions and tunnel access; automatic restart cannot repair authorization"
        : `Tunnel polling returned HTTP 401${auth.attrs.error_code === "token_invalidated" ? " (token_invalidated)" : ""}: replace the invalid runtime key for this tunnel; automatic restart cannot repair authentication` };
  }
  const internal = failures.find(event => Date.parse(event.time) >= now - INTERNAL_FAILURE_RECENCY_MS
    && event.message === "dispatcher received MCP upstream error; posted error response to control plane"
    && event.attrs?.failure_source === "client_internal" && event.attrs.status_code === 502
    && event.attrs.upstream_response_received === false
    && ["initialize", "tools/call"].includes(event.attrs.rpc_method));
  if (internal) return { observed: true, ok: false, fatal: true,
    detail: `MCP transport returned internal HTTP 502 for ${internal.attrs.rpc_method} at ${internal.time}` };
  if (!Number.isFinite(lastSuccess) || lastSuccess < 0 || lastSuccess > now + 5_000) {
    return { observed: false, ok: false, fatal: false, detail: "Tunnel polling success evidence is missing or invalid" };
  }
  if (lastSuccess === 0) return { observed: true, ok: false, fatal: false,
    detail: "Waiting for the tunnel's first successful control-plane poll" };
  // Long polling and local backpressure can leave this timestamp unchanged while
  // healthy. Age alone is not an outage, and polling is not proof of tool delivery.
  return { observed: true, ok: true, fatal: false,
    detail: "Tunnel has completed a successful control-plane poll; MCP transport has no recent internal failures" };
}

async function probeTunnelTransport(baseUrl, timeoutMs = 10_000) {
  const unknown = detail => ({ observed: false, ok: false, fatal: false, detail });
  if (!baseUrl) return unknown("local tunnel MCP diagnostics URL is not known");
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(url.hostname)
    || !url.port || url.username || url.password) return unknown("local tunnel diagnostics endpoint is not verified loopback");
  try {
    const replies = await Promise.allSettled(["/api/logs?limit=100", "/metrics"].map(async route => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(new URL(route, url), { signal: controller.signal, redirect: "error" });
        if (!response.ok) throw new Error(`${route} returned HTTP ${response.status}`);
        return await response.text();
      } finally {
        clearTimeout(timeout);
      }
    }));
    if (replies[0].status !== "fulfilled") return unknown("Tunnel transport diagnostics could not be observed");
    return parseTunnelTransportHealth(JSON.parse(replies[0].value).events,
      replies[1].status === "fulfilled" ? replies[1].value : "");
  } catch {
    // Do not surface response bodies, fetch causes, or arbitrary log attributes.
    return unknown("Tunnel transport diagnostics could not be observed");
  }
}

module.exports = { parseTunnelTransportHealth, probeTunnelTransport };
