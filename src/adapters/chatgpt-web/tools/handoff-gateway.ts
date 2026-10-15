import type { ChatGptTurnEnvironment } from "../prompt/environment";
import { safeVisibleTools } from "./mcp-tool-policy";
import { execGateway, execGatewayProgram, gatewayToolCatalogProgram, excludedGatewayTools } from "./mcp-gateway";
import type { HandoffCall } from "./tool-batch-handoff";

export interface HandoffWireCall extends HandoffCall { scope?: "top_level" | "exec" | "catalog" }
// Only this trusted translator can construct a fixed exec gateway in manual mode.
// User-supplied raw JavaScript remains unavailable there; nested tools retain Codex approvals.
export function handoffCalls(environment: ChatGptTurnEnvironment, contract: "native" | "safe", calls: HandoffWireCall[]): HandoffCall[] {
  const visible = safeVisibleTools(environment, contract);
  return calls.map(call => {
    if (!call || Object.keys(call).some(key => !["name", "namespace", "arguments", "input", "scope"].includes(key))) throw new Error("Invalid handoff call fields");
    const { scope = "top_level", ...body } = call;
    if (scope === "top_level") {
      if (!visible.some(tool => tool.name === call.name && tool.namespace === call.namespace)) {
        const identities = visible.map(tool => ({ name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}) }));
        throw new Error(`Tool is not visible in this contract: ${JSON.stringify({ name: call.name, namespace: call.namespace })}. `
          + `Copy the separate name and namespace fields exactly from codex_tool_inventory; omit namespace when absent. `
          + `Declared top_level identities: ${JSON.stringify(identities)}. `
          + "Nested tools require the advertised discovery gateway and scope exec; do not guess their identities. No batch was accepted.");
      }
      return body;
    }
    if (scope !== "exec" && scope !== "catalog") throw new Error("Unknown tool scope");
    const gateway = execGateway(environment);
    if (!gateway || call.namespace !== undefined || (call.input !== undefined && call.arguments !== undefined)) throw new Error("Native nested tool gateway is unavailable or invalid");
    const excludedNames = excludedGatewayTools(environment, contract);
    let input: string;
    if (scope === "catalog") {
      const { query = "", offset = 0, limit = 50 } = call.arguments ?? {};
      if (call.name !== "$catalog" || call.input !== undefined || typeof query !== "string" || query.length > 256
        || !Number.isSafeInteger(offset) || (offset as number) < 0 || !Number.isSafeInteger(limit) || (limit as number) < 1 || (limit as number) > 100
        || Object.keys(call.arguments ?? {}).some(key => !["query", "offset", "limit"].includes(key))) throw new Error("Invalid nested catalog query");
      input = gatewayToolCatalogProgram({ query, offset: offset as number, limit: limit as number, excludedNames });
    } else input = execGatewayProgram(call.name, call.input !== undefined, body, excludedNames);
    return { name: gateway.name, ...(gateway.namespace ? { namespace: gateway.namespace } : {}), input };
  });
}
