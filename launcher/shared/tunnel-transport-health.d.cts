export interface TunnelTransportHealth {
  observed: boolean;
  ok: boolean;
  fatal: boolean;
  retryable?: boolean;
  code?: "tunnel_authentication_failed" | "tunnel_permission_denied";
  detail: string;
}
export function parseTunnelTransportHealth(events: unknown, metrics: string, now?: number): TunnelTransportHealth;
export function probeTunnelTransport(baseUrl: string | undefined, timeoutMs?: number): Promise<TunnelTransportHealth>;
