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
  sessionStorage.setItem(key(s.sessionId), JSON.stringify(s));
}

export function loadSession(id: string): ClientSession | null {
  if (typeof window === "undefined") return null;
  const raw = sessionStorage.getItem(key(id));
  return raw ? (JSON.parse(raw) as ClientSession) : null;
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
