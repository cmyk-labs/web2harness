export interface SavedChatTask {
  taskKey: string;
  taskName: string;
  kind: "dialogue" | "compaction";
}
export function savedChatId(url: string): string | undefined;
export function validSavedChatTask(value: unknown): value is SavedChatTask;
export function savedChatTitle(createdAt: number, taskName: string, kind: SavedChatTask["kind"], index: number): string;
