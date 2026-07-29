import { describe, expect, it } from "vitest";

import { AUDIT_GENESIS_HASH, buildChain, hashAuditEntry, verifyChain, type PersistedAuditRow } from "@/server/tools/audit-chain";

function row(prevHash: string, at: string, stepNumber: number, summary: string, severity: string): PersistedAuditRow {
  return { stepNumber, summary, severity, prevHash, hash: hashAuditEntry(prevHash, at, stepNumber, summary, severity), at: new Date(at) };
}

describe("audit-chain — tamper detection", () => {
  it("verifies an untouched chain as intact", () => {
    const r1 = row(AUDIT_GENESIS_HASH, "2026-01-01T00:00:00.000Z", 2, "reagent_conflict: HCl + NaOH — swirl gently", "medium");
    const r2 = row(r1.hash, "2026-01-01T00:05:00.000Z", 4, "reagent_conflict: HCl + NaOH — swirl gently", "medium");
    const chain = buildChain([r1, r2]);
    const v = verifyChain(chain);
    expect(v.intact).toBe(true);
    expect(v.verified_count).toBe(2);
  });

  it("detects a row whose content was edited after being written (hash no longer matches)", () => {
    const r1 = row(AUDIT_GENESIS_HASH, "2026-01-01T00:00:00.000Z", 2, "reagent_conflict: HCl + NaOH — swirl gently", "medium");
    const r2 = row(r1.hash, "2026-01-01T00:05:00.000Z", 4, "reagent_conflict: HCl + NaOH — swirl gently", "medium");
    const chain = buildChain([r1, r2]);
    // Simulate a direct DB edit: severity changed after the hash was persisted,
    // without recomputing the hash to match — exactly what a tamperer who only
    // edits the visible content (not the hash column) would do.
    chain[0].severity = "low";
    const v = verifyChain(chain);
    expect(v.intact).toBe(false);
    expect(v.broken_at).toBe(0);
  });

  it("detects a deleted row (downstream prev_hash no longer chains)", () => {
    const r1 = row(AUDIT_GENESIS_HASH, "2026-01-01T00:00:00.000Z", 2, "first alert", "medium");
    const r2 = row(r1.hash, "2026-01-01T00:05:00.000Z", 4, "second alert", "high");
    const r3 = row(r2.hash, "2026-01-01T00:10:00.000Z", 5, "third alert", "low");
    const fullChain = buildChain([r1, r2, r3]);
    // Simulate deleting the middle row from the table before re-fetching.
    const tamperedChain = buildChain([r1, r3]);
    const v = verifyChain(tamperedChain);
    expect(v.intact).toBe(false);
    expect(v.broken_at).toBe(1);
    expect(verifyChain(fullChain).intact).toBe(true);
  });

  it("reports an empty chain as intact with zero events", () => {
    const v = verifyChain(buildChain([]));
    expect(v.intact).toBe(true);
    expect(v.verified_count).toBe(0);
  });
});
