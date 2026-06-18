"use client";

import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

import { saveSession } from "@/hooks/useSession";
import { api } from "@/lib/api-client";
import { newSessionId } from "@/lib/utils";

export function useStartLab() {
  const router = useRouter();
  const { data: authSession } = useSession();
  return useMutation({
    mutationFn: async ({ experimentId, pdfBase64 }: { experimentId?: string; pdfBase64?: string }) => {
      const sessionId = newSessionId();
      const studentName = authSession?.user?.name ?? authSession?.user?.email ?? undefined;
      const res = await api.parseProtocol({
        session_id: sessionId,
        experiment_id: experimentId,
        pdf_base64: pdfBase64,
        student_name: studentName,
      });
      saveSession({ sessionId, protocol: res, currentStepIndex: 0 });
      return sessionId;
    },
    onSuccess: (sessionId) => router.push(`/lab/${sessionId}`),
    onError: (e) => toast.error(`Could not start lab: ${(e as Error).message}`),
  });
}
