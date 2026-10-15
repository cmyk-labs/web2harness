export interface CandidateIdentity { schemaVersion: 1; version: string; sourceId: string; gitCommit: string; files: { path: string; sha256: string }[] }
export function candidateIdentity(root: string): CandidateIdentity;
