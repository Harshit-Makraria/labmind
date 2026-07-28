"use client";

/**
 * Client-side session persistence for the prototype.
 *
 * The authoritative session lives server-side (in-memory store), but the parsed
 * protocol + step cursor are mirrored to sessionStorage so the student flow
 * survives navigation without a GET-protocol endpoint. Keyed by sessionId.
 */
import { useCallback, useEffect, useState } from "react";

import type { ParseProtocolResponse } from "@/lib/types";

export interface ClientSession {
  sessionId: string;
  protocol: ParseProtocolResponse;
  currentStepIndex: number;
}

const key = (id: string) => `labmind:session:${id}`;

export function saveSession(s: ClientSession) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(key(s.sessionId), JSON.stringify(s));
  } catch (e) {
    // Quota exceeded / private-mode storage disabled — the server session is
    // authoritative, so degrade quietly rather than breaking the flow.
    console.warn("[useSession] could not persist session to sessionStorage:", e);
  }
}

export function loadSession(id: string): ClientSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientSession;
    // A truncated or stale entry would otherwise crash the whole lab page on
    // render ("client-side exception"). Drop it and start clean instead.
    if (!parsed?.protocol?.steps?.length) {
      sessionStorage.removeItem(key(id));
      return null;
    }
    return parsed;
  } catch {
    sessionStorage.removeItem(key(id));
    return null;
  }
}

export function useSession(sessionId: string) {
  const [session, setSession] = useState<ClientSession | null>(null);

  useEffect(() => {
    setSession(loadSession(sessionId));
  }, [sessionId]);

  const setStepIndex = useCallback(
    (index: number) => {
      setSession((prev) => {
        if (!prev) return prev;
        const next = { ...prev, currentStepIndex: index };
        saveSession(next);
        return next;
      });
    },
    [],
  );

  return { session, setStepIndex };
}
