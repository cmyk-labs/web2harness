import { createHash } from "node:crypto";
import { SUMMARY_PREFIX } from "../../../responses/compaction";
import type { CodexParsedRequest } from "../../../types";
import { extractChatGptTurnIdentity } from "../prompt/environment";

function messageText(item: Record<string, unknown>): string | undefined {
  const content = item.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return undefined;
  return content.flatMap(block => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return [];
    const text = (block as { text?: unknown }).text;
    return typeof text === "string" ? [text] : [];
  }).join("\n");
}

/** Native compaction remains part of the exact identity of a replayed Codex turn. */
function compactionEpoch(input: unknown[] | undefined): unknown {
  return input?.findLast(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const record = item as Record<string, unknown>;
    return record.type === "compaction"
      || record.type === "compaction_summary"
      || record.type === "context_compaction"
      || (record.role === "user" && messageText(record)?.startsWith(`${SUMMARY_PREFIX}\n`));
  }) ?? null;
}

function conversationScope(
  parsed: CodexParsedRequest,
  namespace: string,
): string | undefined {
  const identity = extractChatGptTurnIdentity(parsed);
  if (!identity.threadId) return undefined;
  const raw = parsed._rawBody as { input?: unknown[] } | undefined;
  return createHash("sha256").update(JSON.stringify({
    transportVersion: 5,
    namespace,
    threadId: identity.threadId,
    modelId: parsed.modelId,
    reasoning: parsed.options.reasoning,
    ...(parsed._chatgptModelFamily ? { modelFamily: parsed._chatgptModelFamily } : {}),
    compaction: compactionEpoch(raw?.input),
  })).digest("hex");
}

interface RetainedSource {
  key: string;
  items: number;
  inputHash: string;
  instructionsHash: string;
}

// Only completed browser submissions populate this bounded, process-local registry. No source
// text or credentials are retained. A daemon restart therefore rebuilds the complete context.
const retainedSources = new Map<string, RetainedSource>();
const sourceHash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value) ?? "undefined").digest("hex");

function matchesPrefix(parsed: CodexParsedRequest, previous: RetainedSource): boolean {
  const source = parsed.context.source;
  return source !== undefined && Array.isArray(source.input) && source.input.length >= previous.items
    && sourceHash(source.instructions) === previous.instructionsHash
    && sourceHash(source.input.slice(0, previous.items)) === previous.inputHash;
}

export function chatGptConversationKey(parsed: CodexParsedRequest, namespace: string): string | undefined {
  const scope = conversationScope(parsed, namespace);
  if (!scope || !parsed.context.source) return scope;
  const previous = retainedSources.get(scope);
  if (previous && matchesPrefix(parsed, previous)) return previous.key;
  // Removed/revised history or changed instructions must not inherit stale browser context.
  return sourceHash([scope, parsed.context.source, previous?.inputHash ?? null]);
}

/** Call only after the owned browser submission has completed with a usable response. */
export function rememberRetainedConversationSource(parsed: CodexParsedRequest, namespace: string, key: string): void {
  const scope = conversationScope(parsed, namespace);
  const source = parsed.context.source;
  if (!scope || !source || !Array.isArray(source.input)) return;
  retainedSources.delete(scope);
  retainedSources.set(scope, {
    key, items: source.input.length, inputHash: sourceHash(source.input), instructionsHash: sourceHash(source.instructions),
  });
  while (retainedSources.size > 128) retainedSources.delete(retainedSources.keys().next().value!);
}

/** Full history remains canonical; send a suffix only after proving the completed input prefix. */
export function retainedConversationResumeRequest(
  parsed: CodexParsedRequest,
  conversationKey?: string,
): CodexParsedRequest | undefined {
  const source = parsed.context.source;
  if (source) {
    const previous = conversationKey ? [...retainedSources.values()].find(entry => entry.key === conversationKey) : undefined;
    if (!previous || !matchesPrefix(parsed, previous) || !Array.isArray(source.input) || source.input.length === previous.items) return parsed;
    return {
      ...parsed,
      context: {
        ...parsed.context,
        source: { ...source, input: source.input.slice(previous.items) },
        sourceContinuation: { prefixItems: previous.items, prefixHash: previous.inputHash },
      },
    };
  }
  const lastAssistant = parsed.context.messages.findLastIndex(message => message.role === "assistant");
  if (lastAssistant < 0 || lastAssistant === parsed.context.messages.length - 1) return undefined;
  return {
    ...parsed,
    context: {
      ...parsed.context,
      messages: parsed.context.messages.slice(lastAssistant + 1),
    },
  };
}
