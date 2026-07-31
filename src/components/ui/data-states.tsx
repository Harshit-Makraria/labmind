"use client";

import { AlertTriangle, type LucideIcon, Lock, RefreshCw, ShieldCheck, WifiOff } from "lucide-react";

/**
 * The three states every data view needs (per the design spec): loading,
 * empty, error-with-retry. Previously every page in the app rendered zero of
 * these for the error case — a failed fetch just showed nothing, or left a
 * spinner running forever. These are the shared, consistent versions.
 */

export function ErrorState({
  title = "Couldn't load this",
  message,
  onRetry,
  /**
   * True when TanStack Query has PAUSED rather than failed — its default
   * networkMode believes the browser is offline and is holding the request
   * rather than erroring, so isError never becomes true and a generic error
   * banner would be the wrong message. Genuinely relevant here: a student on
   * spotty lab WiFi hits this exact state, not just a dropped connection.
   */
  offline,
  /**
   * True for a genuine 401/403 — no amount of retrying or waiting for a
   * connection fixes this, so it must never render as the "offline" state
   * above (which explicitly tells the user retrying isn't necessary because
   * it'll resolve on its own — false and actively misleading for a
   * permissions problem).
   */
  forbidden,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  offline?: boolean;
  forbidden?: boolean;
}) {
  if (forbidden) {
    return (
      <div className="anim-fade-up rounded-[var(--radius-card)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/6 p-5">
        <p className="flex items-center gap-2 font-bold text-[var(--color-danger)]">
          <Lock size={17} className="shrink-0" /> Access denied
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-navy)]">
          You don&apos;t have permission to view this — it may belong to a different instructor account,
          or your session may have expired. Retrying won&apos;t change that; try signing in again.
        </p>
      </div>
    );
  }

  if (offline) {
    return (
      <div className="anim-fade-up rounded-[var(--radius-card)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/8 p-5">
        <p className="flex items-center gap-2 font-bold text-[#b8860b]">
          <WifiOff size={17} className="shrink-0" /> You&apos;re offline
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-navy)]">
          This will load automatically the moment your connection comes back — no need to retry manually.
        </p>
      </div>
    );
  }

  return (
    <div className="anim-fade-up rounded-[var(--radius-card)] border border-[var(--color-danger)]/30 bg-[var(--color-danger)]/6 p-5">
      <p className="flex items-center gap-2 font-bold text-[var(--color-danger)]">
        <AlertTriangle size={17} className="shrink-0" /> {title}
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-[var(--color-navy)]">
        {message ?? "Network timeout or the server didn't respond. Your work in progress is saved locally."}
      </p>
      {onRetry && (
        <button onClick={onRetry} className="btn-primary mt-3 !min-h-[40px] !px-4 text-sm">
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon = ShieldCheck,
  title,
  body,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card anim-fade-up flex flex-col items-center gap-3 border-dashed py-12 text-center">
      <Icon size={36} className="text-[var(--color-muted)]" />
      <p className="font-semibold text-[var(--color-navy)]">{title}</p>
      {body && <p className="max-w-sm text-sm text-[var(--color-muted)]">{body}</p>}
      {action}
    </div>
  );
}

/** Skeleton block for the loading state — matches the shimmer used elsewhere in the app. */
export function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="card anim-fade-up flex flex-col gap-3 p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-3" style={{ width: `${90 - i * 18}%`, animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}
