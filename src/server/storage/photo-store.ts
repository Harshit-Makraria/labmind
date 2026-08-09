/**
 * Where submitted lab photos actually live.
 *
 * Photos were stored as base64 text inside Postgres. That works, and it needs
 * no configuration — which is why it's still the fallback — but it is the wrong
 * home at class scale: base64 inflates bytes by ~33%, every row sits in the
 * primary database (backups, replication, connection-pool memory), and a term
 * of real classes would bloat the DB with binary data it exists to point at,
 * not to hold.
 *
 * This module moves them to Supabase Storage — the same project the database
 * already lives in, so there is no new vendor — and keeps the old path working:
 *
 *   • Configured  → upload to the bucket, store only the object key in Postgres.
 *   • Not configured → return null, and the caller stores base64 exactly as
 *     before. The app remains fully functional with zero setup.
 *   • Reading always handles BOTH, so rows written before this change keep
 *     working forever with no backfill.
 *
 * Deliberately implemented with plain `fetch` against Supabase's Storage REST
 * API rather than pulling in @supabase/supabase-js: three small calls don't
 * justify a dependency in a serverless bundle.
 */
import "server-only";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "lab-photos";

function config(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL?.replace(/\/+$/, "");
  // The service-role key is required: uploads and reads happen server-side on
  // behalf of a student/instructor whose access we've already checked
  // ourselves. This key must never reach the client.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/** True when photos will be written to object storage rather than Postgres. */
export function objectStorageEnabled(): boolean {
  return config() !== null;
}

function objectUrl(cfg: { url: string }, key: string): string {
  return `${cfg.url}/storage/v1/object/${BUCKET}/${key}`;
}

function stripDataUrl(base64: string): string {
  return base64.includes(",") ? base64.split(",", 2)[1] ?? "" : base64;
}

/**
 * Upload one photo. Returns the storage key to persist, or null when object
 * storage isn't configured OR the upload failed.
 *
 * Failure returns null rather than throwing: a storage outage must not cost a
 * student their verified step. The caller falls back to storing base64, so the
 * evidence is still kept either way.
 */
export async function putPhoto(entryId: string, base64: string): Promise<string | null> {
  const cfg = config();
  if (!cfg) return null;

  const raw = stripDataUrl(base64);
  if (!raw) return null;

  // Keyed by entry id — one object per verification entry, no collisions, and
  // trivially derivable when deleting.
  const key = `verifications/${entryId}.jpg`;
  try {
    const bytes = Buffer.from(raw, "base64");
    const res = await fetch(objectUrl(cfg, key), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.key}`,
        "Content-Type": "image/jpeg",
        // Overwrite rather than 409 if the same key is ever retried.
        "x-upsert": "true",
      },
      body: new Uint8Array(bytes),
    });
    if (!res.ok) {
      console.error(`[PHOTO-STORE] upload failed (${res.status}) for ${key} — falling back to database storage`);
      return null;
    }
    console.log(`[PHOTO-STORE] stored ${key} (${Math.round(bytes.length / 1024)} KB)`);
    return key;
  } catch (e) {
    console.error("[PHOTO-STORE] upload threw — falling back to database storage:", e);
    return null;
  }
}

/** Fetch one photo's bytes by storage key. Returns null if unavailable. */
export async function getPhoto(key: string): Promise<Buffer | null> {
  const cfg = config();
  if (!cfg) return null;
  try {
    const res = await fetch(objectUrl(cfg, key), {
      headers: { Authorization: `Bearer ${cfg.key}` },
      cache: "no-store",
    });
    if (!res.ok) {
      console.error(`[PHOTO-STORE] fetch failed (${res.status}) for ${key}`);
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    console.error("[PHOTO-STORE] fetch threw:", e);
    return null;
  }
}

/**
 * Delete photos by key. Used when a user exercises their right to erasure —
 * without this, deleting the database rows would leave the actual images
 * sitting in the bucket, which would make the deletion promise untrue.
 *
 * Best-effort and never throws: a failure here must not block account deletion,
 * but it is logged loudly because it leaves orphaned objects behind.
 */
export async function deletePhotos(keys: string[]): Promise<void> {
  const cfg = config();
  if (!cfg || keys.length === 0) return;
  try {
    const res = await fetch(`${cfg.url}/storage/v1/object/${BUCKET}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefixes: keys }),
    });
    if (!res.ok) {
      console.error(`[PHOTO-STORE] delete failed (${res.status}) — ${keys.length} object(s) may be orphaned: ${keys.join(", ")}`);
      return;
    }
    console.log(`[PHOTO-STORE] deleted ${keys.length} object(s)`);
  } catch (e) {
    console.error("[PHOTO-STORE] delete threw — objects may be orphaned:", e);
  }
}
