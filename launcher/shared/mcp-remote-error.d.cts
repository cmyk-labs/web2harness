export interface McpRemoteFailure {
  kind: "rate_limit" | "authentication" | "permission" | "quota" | "unavailable" | "other";
  source: "probe" | "connector";
  status: number;
  retryAfterMs?: number;
}
export function validMcpRemoteFailure(value: unknown): value is McpRemoteFailure;
export function parseMcpRemoteFailure(content: unknown, now?: number): McpRemoteFailure | undefined;
export function mcpRemoteErrorInfo(value: McpRemoteFailure): { code: string; message: string; retryCandidate: boolean };
