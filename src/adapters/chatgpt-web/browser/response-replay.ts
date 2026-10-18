import { ChatGptResponseSource } from "./response-source";
import { isResponseEvidenceEvent, type ChatGptResponseEvidenceArtifact } from "./response-evidence";

/** Offline diagnostic replay only. A projected result is not original-stream proof, and no result
 * from this function may be delivered to a turn or used to execute tools. Missing evidence is never
 * repaired by silently skipping records. Transport/SSE byte framing is deliberately not claimed.
 */
export function replayChatGptResponseEvidence(artifact: ChatGptResponseEvidenceArtifact, chunkBytes = 17) {
  const unavailable = (reason: "evidence_incomplete" | "evidence_invalid") => ({ state: "unavailable" as const, reason });
  if (artifact?.version !== 1 || artifact.format !== "chatgpt-public-response-events" || !artifact.binding
    || !Array.isArray(artifact.records) || artifact.records.length > 4096 || !artifact.summary
    || !Number.isSafeInteger(chunkBytes) || chunkBytes < 1 || chunkBytes > 65536) return unavailable("evidence_invalid");
  if (!artifact.summary.ended || artifact.summary.framingIncomplete || artifact.summary.dropped || artifact.summary.withheld) {
    return unavailable("evidence_incomplete");
  }
  if (artifact.summary.events !== artifact.records.length || artifact.summary.retained !== artifact.records.length) return unavailable("evidence_incomplete");
  let bytes = 0, projected = 0;
  for (const [index, record] of artifact.records.entries()) {
    if (record.sequence !== index + 1 || record.kind === "withheld" || typeof record.data !== "string") return unavailable("evidence_incomplete");
    if (!["original", "projected"].includes(record.kind) || !isResponseEvidenceEvent(record.event)) return unavailable("evidence_invalid");
    if ((bytes += Buffer.byteLength(record.data)) > 4 * 1024 * 1024) return unavailable("evidence_invalid");
    if (record.kind === "projected") projected++;
  }
  if (projected !== artifact.summary.projected) return unavailable("evidence_invalid");
  const source = new ChatGptResponseSource(artifact.binding);
  for (const record of artifact.records) {
    const wire = Buffer.from(`event: ${record.event}\n${record.data!.split("\n").map(line => `data: ${line}`).join("\n")}\n\n`);
    for (let offset = 0; offset < wire.length; offset += chunkBytes) source.push(wire.subarray(offset, offset + chunkBytes));
  }
  source.finish();
  return { state: "replayed" as const, fidelity: projected ? "privacy-projected" as const : "original-events" as const,
    result: source.result(), facts: source.facts() };
}
