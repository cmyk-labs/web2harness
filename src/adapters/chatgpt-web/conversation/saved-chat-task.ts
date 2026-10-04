import { createHash } from "node:crypto";
import type { SavedChatTask } from "../../../../launcher/shared/saved-chat.cjs";
import type { CodexParsedRequest } from "../../../types";
import { chatGptTurnUserRevisionHistory, extractChatGptTurnIdentity } from "../prompt/environment";

/** Use canonical human input once; the launcher preserves the name through compaction and resume. */
export function savedChatTask(parsed: CodexParsedRequest): SavedChatTask | undefined {
  const { threadId } = extractChatGptTurnIdentity(parsed);
  if (!threadId) return undefined;
  const content = chatGptTurnUserRevisionHistory(parsed)[0]?.content;
  let text = typeof content === "string" ? content : Array.isArray(content)
    ? content.flatMap(block => block && typeof block === "object" && typeof block.text === "string" ? [block.text] : []).join("\n")
    : "";
  // IDE scaffolding is not a useful task title.
  text = text.split(/(?:^|\n)##?\s*(?:My request|我的请求)\s*[:：]\s*\n/i).at(-1) ?? text;
  text = text.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, " ").replace(/[\u0000-\u001f\u007f·]/g, " ")
    .replace(/\s+/g, " ").trim();
  const taskName = Array.from(text).slice(0, 36).join("") || `Codex ${threadId.slice(-6)}`;
  return {
    taskKey: createHash("sha256").update(threadId).digest("hex"),
    taskName,
    kind: parsed._compactionRequest ? "compaction" : "dialogue",
  };
}
