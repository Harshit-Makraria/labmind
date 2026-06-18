"use client";

import { FlaskConical, Loader2, Eye, EyeOff } from "lucide-react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const error = params.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) return;
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      toast.error("Invalid email or password");
      return;
    }
    const sessionRes = await fetch("/api/auth/session");
    const session = await sessionRes.json();
    const role = session?.user?.role ?? "student";
    router.push(role === "instructor" ? "/instructor/dashboard" : "/student/dashboard");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-surface)] px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-navy)]">
            <FlaskConical size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-extrabold text-[var(--color-navy)]">Welcome back</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Sign in to LabMind</p>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error === "CredentialsSignin" ? "Invalid email or password." : "Sign-in failed. Please try again."}
          </div>
        )}

        <form onSubmit={handleLogin} className="card space-y-4 p-6">
          <div>
            <label className="mb-1.5 block text-sm font-semibold text-[var(--color-navy)]">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="input-base"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-[var(--color-navy)]">Password</label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="input-base pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--color-muted)]"
              >
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-navy)] py-3 font-semibold text-white disabled:opacity-40"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--color-muted)]">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="font-semibold text-[var(--color-brand)] hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}

export default function AuthPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
