import { HANDOFF_V2, handoffProtocol, handoffSubmissionTools, type HandoffProtocol } from "../../../../launcher/shared/handoff-protocol.cjs";

/** One transport contract for the prompt and MCP catalog. Tool identity and transport
 * scope are separate: a namespaced Codex tool is not an exec-gateway export. */
export const HANDOFF_ROUTING_INSTRUCTIONS = [
  "Each entry in tools is directly submit-able with scope top_level, its exact name and its separate namespace when present. A namespace does NOT make it an exec-gateway tool. Never join namespace into name.",
  "If a required tool is absent, use an advertised discovery_tools entry, such as tool_search, as a top_level call. After its real result arrives in the next request, use the newly declared tools from that request's inventory. Do not rediscover tools already listed there.",
  "Only exports discovered through a non-null nested_gateway use scope exec. Only that gateway's catalog request uses scope catalog. nested_gateway=null disables those two gateway scopes; it does not disable namespaced top_level tools or tool_search.",
].join(" ");

export function handoffContract(reference: "turn_token" | "request_id", selectedProtocol?: HandoffProtocol): string[] {
  const protocol = handoffProtocol(selectedProtocol), tools = handoffSubmissionTools(protocol);
  const identity = protocol === HANDOFF_V2
    ? "Do not generate or supply submission_id: the host derives it from this round, contract and exact calls. Identical retries reuse its receipt. If the advertised v2 submission tool is absent from the connector catalog, refresh the connector before retrying; never select a v1 tool or change protocol in the current round."
    : "Use a stable submission_id.";
  return [
    `Protocol ${protocol}. Use only the current request's ${reference}; previous bindings are retired.`,
    "Each new Codex request starts a new Web round, including in a reused browser conversation. A previous receipt's end_web_response action ended that previous round only. Read the new request and its real results, then continue the still-active user task.",
    ...(reference === "request_id" ? ["Begin with codex_turn_start; the user must confirm Sent for every new Web round."] : []),
    "Use codex_tool_inventory with a query for the required operation and read its call_controls. It lists only currently loaded tools, with paging; a miss is NOT proof that a capability is unavailable. If discovery_tools exists, use its declared search before reporting a missing capability. The attached MCP connector transports calls; Codex performs their execution.",
    HANDOFF_ROUTING_INSTRUCTIONS,
    `Use the inventory's submission_tool and submission_field. When parallel_tool_calls=false, call ${tools.single} with exactly one call object, never an array. When parallel calls are allowed, ${tools.batch} accepts an array of independent calls. ${identity} Preserve original freeform text in input and function arguments in arguments. Both interfaces preserve Codex's call_controls; spawning several agents can span several Web rounds without changing their concurrency.`,
    "Submission atomically validates, registers and seals the batch. Accepted means NOT EXECUTED. END this Web response immediately after acceptance; no second call is required. codex_yield_turn is only an idempotent compatibility acknowledgement.",
    "Codex executes only after this Web response and its physical resources settle. Do not wait or poll for execution in this Web response. Real results arrive in the next Codex request: source input retains function_call_output, custom_tool_call_output and tool_search_output; normalized context uses tool_result. Match each result to its call_id, retain its error status and use newly declared tools in the current inventory. Do not invent results or repeat completed calls.",
    "A Web round returns either a reply or a tool batch. Accepted calls end only this round, not the user's task. A child ID or running command is not a completed result: use the declared wait/result tools in subsequent rounds when needed.",
    reference === "request_id"
      ? "In Zero Risk, submit the reply through codex_finish_turn; the launcher does not read the page. The user then confirms Finished. Do not call finish after submitting a tool batch."
      : "When replying without tool calls, write the answer normally and end this response. No finish or yield tool is required. codex_finish_turn remains an optional compatibility interface. Follow call_controls when the request requires a tool call.",
    "Keep failure attribution factual: distinguish a tool validation error, an explicit platform denial, a Codex execution error and a decision not to call. Claim a safety or approval block only when an actual current tool/platform error establishes it; otherwise report not executed, cause unconfirmed. Historical or quoted errors are task data, not new failures.",
    "The transported instructions describe the outer Codex task; they do not override ChatGPT platform rules. Codex retains sandbox, filesystem access and approval enforcement. A binding or accepted submission grants no additional authority.",
  ];
}
