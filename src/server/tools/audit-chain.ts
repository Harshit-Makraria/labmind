/**
 * Tamper-evident safety log (hash chain).
 *
 * The accreditation buyer's real question is not "did the AI spot the hazard"
 * but "can you prove this record was not edited after the incident". A plain
 * database table cannot answer that — rows can be updated silently.
 *
 * Each entry embeds the hash of the entry before it, so altering, reordering,
 * or deleting any historical event breaks every hash downstream of it and the
 * verification fails at a nameable index. This does not prevent tampering; it
 * makes tampering *detectable*, which is what an audit requires.
 */
import "server-only";
import { createHash } from "crypto";
import type { SafetyLogEntry } from "@/lib/types";

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

const GENESIS = "0".repeat(64);

function hashEntry(prevHash: string, at: string, step: number, summary: string, severity: string): string {
  return createHash("sha256")
    .update(`${prevHash}|${at}|${step}|${summary}|${severity}`)
    .digest("hex");
}

/**
 * Build the chain from a session's safety log. Deterministic: the same log
 * always yields the same hashes, which is what makes re-verification possible
 * without storing the chain separately.
 */
export function buildChain(log: SafetyLogEntry[]): ChainedEvent[] {
  const sorted = [...log].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  const out: ChainedEvent[] = [];
  let prev = GENESIS;

  sorted.forEach((entry, i) => {
    const top = entry.alerts[0];
    const summary = top
      ? `${top.type}: ${top.reagents.join(" + ")} — ${top.action}`
      : "Safety check recorded";
    const severity = top?.severity ?? "low";
    const hash = hashEntry(prev, entry.at, entry.step_number, summary, severity);
    out.push({ index: i, at: entry.at, step_number: entry.step_number, summary, severity, prev_hash: prev, hash });
    prev = hash;
  });

  return out;
}

/** Recompute every hash and report the first mismatch. */
export function verifyChain(chain: ChainedEvent[]): ChainVerification {
  let prev = GENESIS;

  for (const e of chain) {
    if (e.prev_hash !== prev) {
      return {
        intact: false,
        verified_count: e.index,
        broken_at: e.index,
        message: `Chain broken at entry ${e.index + 1} — an earlier record was altered or removed after it was written.`,
      };
    }
    const expected = hashEntry(prev, e.at, e.step_number, e.summary, e.severity);
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
