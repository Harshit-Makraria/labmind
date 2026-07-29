/**
 * Tamper-evident safety log (hash chain).
 *
 * The accreditation buyer's real question is not "did the AI spot the hazard"
 * but "can you prove this record was not edited after the incident". A plain
 * database table cannot answer that — rows can be updated silently.
 *
 * Each entry's hash is computed and PERSISTED at write time (see
 * `appendAuditEntry` in session-store.ts) from that entry's own content plus
 * the previous entry's already-persisted hash, into an append-only table
 * (`AuditLogEntry` — no update/delete path exists anywhere in the app for it).
 * Verification re-derives each hash from the row's current content and
 * compares it to the hash stored back when the row was written: if a row's
 * content is edited afterward (e.g. directly in the database) without also
 * correctly re-deriving that row's hash AND every hash downstream of it, the
 * mismatch is caught at a nameable index. Earlier, this chain was rebuilt
 * from scratch from the same live, mutable `safetyLog` JSON column every time
 * it was verified — which meant an edited log recomputed a brand-new,
 * internally-consistent chain and always reported "intact". Persisting the
 * hash independently of the mutable display copy is what makes the
 * detectable property real.
 */
import "server-only";
import { createHash } from "crypto";

export interface ChainedEvent {
  index: number;
  at: string;
  step_number: number;
  summary: string;
  severity: string;
  /** Hash of the preceding entry — "0".repeat(64) for the genesis entry. */
  prev_hash: string;
  hash: string;
}

export interface ChainVerification {
  intact: boolean;
  verified_count: number;
  /** Index of the first entry that failed verification, when intact is false. */
  broken_at: number | null;
  message: string;
}

export const AUDIT_GENESIS_HASH = "0".repeat(64);

export function hashAuditEntry(prevHash: string, at: string, step: number, summary: string, severity: string): string {
  return createHash("sha256")
    .update(`${prevHash}|${at}|${step}|${summary}|${severity}`)
    .digest("hex");
}

export interface PersistedAuditRow {
  stepNumber: number;
  summary: string;
  severity: string;
  prevHash: string;
  hash: string;
  at: Date;
}

/**
 * Format already-hashed, already-ordered DB rows as a chain for display and
 * verification. Unlike the old in-memory version, this does NOT recompute
 * hashes — the rows already carry the hash fixed at insert time.
 */
export function buildChain(rows: PersistedAuditRow[]): ChainedEvent[] {
  return rows.map((r, i) => ({
    index: i,
    at: r.at.toISOString(),
    step_number: r.stepNumber,
    summary: r.summary,
    severity: r.severity,
    prev_hash: r.prevHash,
    hash: r.hash,
  }));
}

/** Recompute every hash from current row content and report the first mismatch. */
export function verifyChain(chain: ChainedEvent[]): ChainVerification {
  let prev = AUDIT_GENESIS_HASH;

  for (const e of chain) {
    if (e.prev_hash !== prev) {
      return {
        intact: false,
        verified_count: e.index,
        broken_at: e.index,
        message: `Chain broken at entry ${e.index + 1} — an earlier record was altered or removed after it was written.`,
      };
    }
    const expected = hashAuditEntry(prev, e.at, e.step_number, e.summary, e.severity);
    if (expected !== e.hash) {
      return {
        intact: false,
        verified_count: e.index,
        broken_at: e.index,
        message: `Chain broken at entry ${e.index + 1} — this record's contents no longer match its signature.`,
      };
    }
    prev = e.hash;
  }

  return {
    intact: true,
    verified_count: chain.length,
    broken_at: null,
    message: chain.length
      ? `Chain intact — ${chain.length} safety event${chain.length === 1 ? "" : "s"} verified.`
      : "No safety events recorded for this session.",
  };
}
