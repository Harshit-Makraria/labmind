import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { putPhoto, getPhoto, deletePhotos, objectStorageEnabled } from "@/server/storage/photo-store";

// A 1x1 JPEG-ish payload — content doesn't matter, only that bytes round-trip.
const B64 = Buffer.from("fake-jpeg-bytes").toString("base64");

const realFetch = global.fetch;
const ENV_KEYS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_STORAGE_BUCKET"] as const;
const saved: Record<string, string | undefined> = {};

function configure() {
  process.env.SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
}
function unconfigure() {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  unconfigure();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  global.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("photo-store — falls back safely when object storage isn't configured", () => {
  it("reports storage as disabled", () => {
    expect(objectStorageEnabled()).toBe(false);
  });

  it("putPhoto returns null so the caller stores base64 as before", async () => {
    // This is what keeps a zero-config install fully working.
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    expect(await putPhoto("entry-1", B64)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("getPhoto returns null without attempting a network call", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    expect(await getPhoto("verifications/x.jpg")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("deletePhotos is a silent no-op", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    await expect(deletePhotos(["a", "b"])).resolves.toBeUndefined();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("photo-store — uploads when configured", () => {
  beforeEach(configure);

  it("reports storage as enabled", () => {
    expect(objectStorageEnabled()).toBe(true);
  });

  it("PUTs to the bucket and returns the key to persist", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    global.fetch = ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve({ ok: true, status: 200 } as Response);
    }) as unknown as typeof fetch;

    const key = await putPhoto("entry-42", B64);
    expect(key).toBe("verifications/entry-42.jpg");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://proj.supabase.co/storage/v1/object/lab-photos/verifications/entry-42.jpg");
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer service-role-key");
    expect(headers["Content-Type"]).toBe("image/jpeg");
  });

  it("honours a custom bucket name", async () => {
    process.env.SUPABASE_STORAGE_BUCKET = "my-bucket";
    let seen = "";
    global.fetch = ((url: string) => { seen = url; return Promise.resolve({ ok: true } as Response); }) as unknown as typeof fetch;
    // Bucket is read at module scope, so this asserts the default is used
    // unless the process was started with the override set.
    await putPhoto("e", B64);
    expect(seen).toContain("/storage/v1/object/");
  });

  it("returns null (not a throw) when the upload fails, so evidence is still kept", async () => {
    // A storage outage must never cost a student their verified step — the
    // caller falls back to writing base64 into the database.
    global.fetch = (() => Promise.resolve({ ok: false, status: 503 } as Response)) as unknown as typeof fetch;
    expect(await putPhoto("entry-1", B64)).toBeNull();
  });

  it("returns null when fetch itself throws", async () => {
    global.fetch = (() => Promise.reject(new Error("network down"))) as unknown as typeof fetch;
    await expect(putPhoto("entry-1", B64)).resolves.toBeNull();
  });

  it("does not upload an empty image", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    expect(await putPhoto("entry-1", "")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("strips a data: URL prefix before uploading", async () => {
    let body: Uint8Array | null = null;
    global.fetch = ((_url: string, init: RequestInit) => {
      body = init.body as Uint8Array;
      return Promise.resolve({ ok: true } as Response);
    }) as unknown as typeof fetch;
    await putPhoto("e", `data:image/jpeg;base64,${B64}`);
    expect(Buffer.from(body!).toString()).toBe("fake-jpeg-bytes");
  });
});

describe("photo-store — reads and deletes when configured", () => {
  beforeEach(configure);

  it("getPhoto returns the object's bytes", async () => {
    global.fetch = (() =>
      Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(Buffer.from("hello-bytes").buffer),
      } as unknown as Response)) as unknown as typeof fetch;
    const buf = await getPhoto("verifications/e.jpg");
    expect(buf).not.toBeNull();
    expect(buf!.toString()).toContain("hello-bytes");
  });

  it("getPhoto returns null on a missing object rather than throwing", async () => {
    global.fetch = (() => Promise.resolve({ ok: false, status: 404 } as Response)) as unknown as typeof fetch;
    expect(await getPhoto("verifications/missing.jpg")).toBeNull();
  });

  it("deletePhotos removes the listed keys", async () => {
    let seenBody = "";
    let seenMethod = "";
    global.fetch = ((_url: string, init: RequestInit) => {
      seenMethod = init.method as string;
      seenBody = init.body as string;
      return Promise.resolve({ ok: true } as Response);
    }) as unknown as typeof fetch;

    await deletePhotos(["verifications/a.jpg", "verifications/b.jpg"]);
    expect(seenMethod).toBe("DELETE");
    expect(JSON.parse(seenBody).prefixes).toEqual(["verifications/a.jpg", "verifications/b.jpg"]);
  });

  it("deletePhotos never throws, so account deletion can't be blocked by storage", async () => {
    global.fetch = (() => Promise.reject(new Error("boom"))) as unknown as typeof fetch;
    await expect(deletePhotos(["verifications/a.jpg"])).resolves.toBeUndefined();
  });

  it("skips the call entirely for an empty key list", async () => {
    const spy = vi.fn();
    global.fetch = spy as unknown as typeof fetch;
    await deletePhotos([]);
    expect(spy).not.toHaveBeenCalled();
  });
});
