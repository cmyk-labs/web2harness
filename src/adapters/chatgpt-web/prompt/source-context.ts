import type { CodexSourceContext, CodexTool } from "../../../types";
import { parseInputFile } from "../../../responses/file-input";
import { decodeCompactionSummary } from "../../../responses/compaction";
import { decodeReasoningEnvelope } from "../../../responses/reasoning-envelope";
import { createInputFile, type ChatGptInputFile } from "./file-attachments";
import type { ChatGptWebPromptImage } from "./compile";
import { createHash } from "node:crypto";
import { selectedSkillFile, type ChatGptSkillFile } from "./skill-attachments";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function originalToolSpecification(tool: CodexTool): Record<string, unknown> {
  return tool.specification ? structuredClone(tool.specification) : {
    type: tool.toolSearch ? "tool_search" : tool.freeform ? "custom" : "function",
    name: tool.name,
    ...(tool.namespace ? { namespace: tool.namespace } : {}),
    description: tool.description,
    ...(!tool.freeform ? { parameters: tool.parameters } : {}),
    ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
    ...(tool.format ? { format: tool.format } : {}),
  };
}

/** Original namespace trees are retained; this is not a flattened function catalog. */
export function originalToolCatalog(source: CodexSourceContext | undefined, tools: readonly CodexTool[]): unknown[] {
  if (!source) return tools.map(originalToolSpecification);
  const catalog = structuredClone(source.tools ?? []);
  if (Array.isArray(source.input)) {
    for (const item of source.input) {
      if (!record(item) || !Array.isArray(item.tools)) continue;
      if (item.type === "additional_tools" || (item.type === "tool_search_output"
        && (item.status === undefined || item.status === "completed" || item.status === "success"))) {
        catalog.push(...structuredClone(item.tools));
      }
    }
  }
  return catalog.map(spec => typeof spec === "string" ? JSON.parse(spec) : spec);
}

const inputTypes = new Set([
  "message", "agent_message", "reasoning", "function_call", "custom_tool_call", "local_shell_call",
  "function_call_output", "custom_tool_call_output", "tool_search_call", "tool_search_output",
  "additional_tools", "compaction", "compaction_summary", "context_compaction", "compaction_trigger",
  "web_search_call",
]);
const textTypes = new Set(["input_text", "output_text", "text", "refusal", "summary_text", "reasoning_text"]);

/**
 * Only binary attachment storage and our own reversible envelopes are decoded here. Content,
 * roles, boundaries, unknown metadata and historical (even invalid) arguments remain unchanged.
 */
export function encodeSourceContext(
  source: CodexSourceContext,
  images: ChatGptWebPromptImage[],
  files: ChatGptInputFile[],
  skillFiles: ChatGptSkillFile[] = [],
  attachSkills = false,
): Record<string, unknown> {
  const encoded = structuredClone(source);
  const decoded: Array<{ input_index: number; type: string; value: unknown }> = [];
  const content = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    return value.map(block => {
      if (!record(block)) throw new Error("Unsupported Codex content block");
      if (textTypes.has(String(block.type))) return block;
      if (block.type === "input_image") {
        if (typeof block.image_url !== "string" || !block.image_url) {
          throw new Error("Codex image has no readable image_url; file_id cannot be resolved by ChatGPT Web");
        }
        const ref = `codex-input-image-${images.length + 1}`;
        images.push({ ref, imageUrl: block.image_url, ...(typeof block.detail === "string" ? { detail: block.detail } : {}) });
        const { image_url: _url, ...metadata } = block;
        return { ...metadata, attachment_ref: ref };
      }
      if (block.type === "input_file") {
        const file = createInputFile(parseInputFile(block));
        if (!files.some(existing => existing.name === file.name)) files.push(file);
        const { file_data: _data, ...metadata } = block;
        return { ...metadata, attachment_ref: file.name };
      }
      throw new Error(`Unsupported Codex content type: ${String(block.type)}; context was not sent`);
    });
  };
  if (Array.isArray(encoded.input)) {
    encoded.input = encoded.input.map((item, index) => {
      if (!record(item)) throw new Error("Unsupported Codex input item");
      const type = item.type ?? (typeof item.role === "string" ? "message" : undefined);
      if (!inputTypes.has(String(type))) throw new Error(`Unsupported Codex input type: ${String(type)}; context was not sent`);
      if (typeof item.encrypted_content === "string" && item.encrypted_content.length > 0) {
        const value = type === "reasoning" ? decodeReasoningEnvelope(item.encrypted_content)
          : ["compaction", "compaction_summary", "context_compaction"].includes(String(type))
            ? decodeCompactionSummary(item.encrypted_content) : null;
        if (value === null) throw new Error(`Opaque Codex ${String(type)} cannot be decoded by ChatGPT Web; context was not sent`);
        decoded.push({ input_index: index, type: String(type), value });
      }
      const metadata = record(item.internal_chat_message_metadata_passthrough) ? item.internal_chat_message_metadata_passthrough : undefined;
      const kinds = metadata?.content_item_kinds;
      if (attachSkills && item.role === "user" && Array.isArray(kinds)
        && kinds.length === 1 && kinds[0] === "skills.selected_skill_instructions") {
        const value = item.content;
        const parts = typeof value === "string" ? value : Array.isArray(value) ? value.map(block => {
          if (!record(block) || !["input_text", "text"].includes(String(block.type)) || typeof block.text !== "string") {
            throw new Error("Selected skill instructions must contain only text");
          }
          return { type: "text" as const, text: block.text };
        }) : [];
        const original = selectedSkillFile({ role: "user", origin: "codex_skill", content: parts, timestamp: 0 });
        const text = typeof value === "string" ? value : JSON.stringify(value);
        const digest = createHash("sha256").update(text).digest("hex").slice(0, 16);
        const name = original.name.replace(/--[a-f0-9]{16}\.txt$/, `--${digest}.txt`);
        if (!skillFiles.some(file => file.name === name)) skillFiles.push({ name, text });
        item.content = { type: "skill_attachment", attachment_ref: name, encoding: typeof value === "string" ? "text" : "json" };
      } else if (item.content !== undefined) item.content = content(item.content);
      if (item.summary !== undefined) item.summary = content(item.summary);
      if (item.output !== undefined) item.output = content(item.output);
      return item;
    });
  }
  return {
    ...encoded,
    ...(decoded.length ? { transport_decoded: decoded } : {}),
  };
}
