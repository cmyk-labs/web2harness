export const MAX_LOG_BYTES: number;
export const MAX_RETAINED_BYTES: number;
export const RETENTION_DAYS: number;
export function appendBoundedLog(file: string, text: string): void;
export function maintainLogDirectory(directory: string): void;
export function pruneLogDirectory(directory: string, now?: number): void;
export function startLogMaintenance(directories: string[], onError?: (error: unknown) => void): () => void;
