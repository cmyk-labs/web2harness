const HANDOFF_V1 = "web2harness-handoff-v1";
const HANDOFF_V2 = "web2harness-handoff-v2";

function handoffProtocol(value) {
  if (value === undefined) return HANDOFF_V1;
  if (value !== HANDOFF_V1 && value !== HANDOFF_V2) throw new Error("Unsupported MCP handoff protocol");
  return value;
}

function handoffSubmissionTools(protocol) {
  const suffix = handoffProtocol(protocol) === HANDOFF_V2 ? "_v2" : "";
  return { single: `codex_submit_tool_call${suffix}`, batch: `codex_submit_tool_batch${suffix}` };
}

module.exports = { HANDOFF_V1, HANDOFF_V2, handoffProtocol, handoffSubmissionTools };
