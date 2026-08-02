"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signOut } from "next-auth/react";
import { AlertTriangle, CheckCircle2, ClipboardList, Download, FlaskConical, Pencil, ShieldCheck, Trash2, Users, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/data-states";
import { api, isForbidden } from "@/lib/api-client";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { ProfileData } from "@/lib/types";

export default function ProfilePage() {
  const qc = useQueryClient();
  const { data: profile, isError, isPaused, error, failureReason, refetch } = useQuery<ProfileData>({
    queryKey: ["profile"],
    queryFn: () => api.profile(),
  });

  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  const renameMutation = useMutation({
    mutationFn: (name: string) => api.updateProfileName(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Name updated");
      setEditingName(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update your name"),
  });

  if (isError || isPaused) {
    const forbidden = isForbidden(error) || isForbidden(failureReason);
    return <ErrorState title="Couldn't load your profile" onRetry={() => refetch()} offline={!forbidden && isPaused} forbidden={forbidden} />;
  }
  if (!profile) {
    return <div className="card anim-fade-up h-40 animate-pulse" />;
  }

  const initials = (profile.name || profile.email).slice(0, 2).toUpperCase();
  const memberSince = new Date(profile.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Identity card */}
      <div className="card anim-fade-up flex flex-wrap items-center gap-4 p-6">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand)]/12 text-xl font-bold text-[var(--color-brand)]">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          {editingName ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && nameDraft.trim()) renameMutation.mutate(nameDraft.trim());
                  if (e.key === "Escape") setEditingName(false);
                }}
                className="min-h-[38px] max-w-xs rounded-lg border border-black/15 px-3 text-lg font-bold text-[var(--color-navy)] outline-none focus:border-[var(--color-brand)]"
                aria-label="Your display name"
              />
              <button
                disabled={!nameDraft.trim() || renameMutation.isPending}
                onClick={() => renameMutation.mutate(nameDraft.trim())}
                className="rounded-lg bg-[var(--color-accent)] px-3 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Save
              </button>
              <button onClick={() => setEditingName(false)} className="rounded-lg border border-black/12 px-3 py-2 text-sm font-semibold text-[var(--color-navy)]">
                Cancel
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xl font-extrabold text-[var(--color-navy)]">
              {profile.name || "Unnamed"}
              <button
                onClick={() => { setNameDraft(profile.name ?? ""); setEditingName(true); }}
                aria-label="Edit display name"
                className="text-[var(--color-muted)] hover:text-[var(--color-brand)]"
              >
                <Pencil size={15} />
              </button>
            </p>
          )}
          <p className="text-sm text-[var(--color-muted)]">{profile.email}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <span className={`chip ${profile.role === "instructor" ? "bg-[var(--color-navy)]/10 text-[var(--color-navy)]" : "bg-[var(--color-accent)]/12 text-[var(--color-accent)]"}`}>
              <Users size={12} /> {profile.role}
            </span>
            <span className="text-xs text-[var(--color-muted)]">Member since {memberSince}</span>
          </div>
        </div>
      </div>

      {/* Stats */}
      {profile.role === "instructor" && profile.instructor_stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={FlaskConical} label="Classes created" value={profile.instructor_stats.classes_created} />
          <StatCard icon={Users} label="Total students" value={profile.instructor_stats.total_students} />
          <StatCard icon={ClipboardList} label="Verifications resolved" value={profile.instructor_stats.verifications_resolved} />
          <StatCard
            icon={ShieldCheck}
            label="AI agreement"
            value={profile.instructor_stats.agreement !== null ? `${Math.round(profile.instructor_stats.agreement * 100)}%` : "—"}
          />
        </div>
      ) : profile.student_stats ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={FlaskConical} label="Experiments started" value={profile.student_stats.experiments_started} />
          <StatCard icon={CheckCircle2} label="Completed" value={profile.student_stats.experiments_completed} />
          <StatCard icon={ShieldCheck} label="Accurate (≤5% off)" value={profile.student_stats.accurate_count} />
          <StatCard
            icon={ClipboardList}
            label="Avg deviation"
            value={profile.student_stats.avg_deviation !== null ? `${profile.student_stats.avg_deviation}%` : "—"}
          />
        </div>
      ) : null}

      {/* Account & privacy */}
      <div className="card anim-fade-up space-y-4 p-6">
        <h2 className="text-lg font-bold text-[var(--color-navy)]">Your data</h2>
        <p className="text-sm text-[var(--color-muted)]">
          Download a copy of everything tied to your account, or read how LabMind handles your data.
        </p>
        <div className="flex flex-wrap gap-3">
          <a
            href="/api/profile/export"
            download
            className="inline-flex items-center gap-2 rounded-xl border border-black/12 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-navy)] hover:bg-[var(--color-surface)]"
          >
            <Download size={16} /> Export my data
          </a>
          <Link
            href="/privacy"
            className="inline-flex items-center gap-2 rounded-xl border border-black/12 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-navy)] hover:bg-[var(--color-surface)]"
          >
            Privacy Policy
          </Link>
          <Link
            href="/terms"
            className="inline-flex items-center gap-2 rounded-xl border border-black/12 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--color-navy)] hover:bg-[var(--color-surface)]"
          >
            Terms of Service
          </Link>
        </div>
      </div>

      {/* Danger zone */}
      <div className="card anim-fade-up space-y-3 border-l-[3px] border-[var(--color-danger)] p-6">
        <h2 className="flex items-center gap-2 text-lg font-bold text-[var(--color-danger)]">
          <AlertTriangle size={18} /> Danger zone
        </h2>
        <p className="text-sm text-[var(--color-muted)]">
          {profile.role === "instructor"
            ? "Permanently deletes your account and your own lab history. Classes you created are detached rather than deleted — your students keep their own records."
            : "Permanently deletes your account and your entire lab history. This cannot be undone."}
        </p>
        <button
          onClick={() => setShowDeleteModal(true)}
          className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-danger)]/40 px-4 py-2.5 text-sm font-semibold text-[var(--color-danger)] hover:bg-[var(--color-danger)]/8"
        >
          <Trash2 size={16} /> Delete my account
        </button>
      </div>

      {showDeleteModal && <DeleteAccountModal onClose={() => setShowDeleteModal(false)} />}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof FlaskConical; label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <Icon size={16} className="text-[var(--color-brand)]" />
      <p className="mt-2 text-xl font-extrabold text-[var(--color-navy)]">{value}</p>
      <p className="text-xs text-[var(--color-muted)]">{label}</p>
    </div>
  );
}

function DeleteAccountModal({ onClose }: { onClose: () => void }) {
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const trapRef = useFocusTrap<HTMLDivElement>(true, onClose);

  async function handleDelete() {
    setDeleting(true);
    try {
      await api.deleteAccount();
      toast.success("Account deleted");
      await signOut({ callbackUrl: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't delete your account");
      setDeleting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div
        ref={trapRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        tabIndex={-1}
        className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-2xl"
      >
        <div className="mb-3 flex items-start justify-between">
          <h2 id="delete-account-title" className="text-lg font-bold text-[var(--color-danger)]">Delete your account?</h2>
          <button onClick={onClose} aria-label="Cancel" className="text-[var(--color-muted)] hover:text-[var(--color-navy)]">
            <X size={20} />
          </button>
        </div>
        <p className="text-sm text-[var(--color-navy)]/80">
          This permanently deletes your account and lab history. It cannot be undone. Type <strong>DELETE</strong> to confirm.
        </p>
        <input
          autoFocus
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          aria-label='Type DELETE to confirm'
          className="mt-3 min-h-[44px] w-full rounded-lg border-2 border-black/12 px-3 font-mono outline-none focus:border-[var(--color-danger)]"
        />
        <div className="mt-4 flex gap-2">
          <button
            disabled={confirmText !== "DELETE" || deleting}
            onClick={handleDelete}
            className="btn-danger flex-1 disabled:opacity-40"
          >
            {deleting ? "Deleting…" : "Permanently delete"}
          </button>
          <button onClick={onClose} className="btn-ghost flex-1">Cancel</button>
        </div>
      </div>
    </div>
  );
}
