"use client";

import { GraduationCap, Loader2, Eye, EyeOff, BookOpen } from "lucide-react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

export default function SignupPage() {
  const router = useRouter();
  const [role, setRole] = useState<"student" | "instructor">("student");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || !role) return;
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setLoading(true);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await res.json();

    if (!res.ok) {
      toast.error(data.error ?? "Sign-up failed");
      setLoading(false);
      return;
    }

    // Auto sign-in after registration
    const signInRes = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (signInRes?.error) {
      toast.error("Account created but sign-in failed. Please log in.");
      router.push("/auth");
      return;
    }
    toast.success("Account created! Welcome to LabMind.");
    router.push(role === "instructor" ? "/instructor/dashboard" : "/student/dashboard");
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-[var(--color-surface)] px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        {/* Logo */}
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-[var(--color-navy)] shadow-sm">
            <img src="/logo2.png" alt="LabMind" className="h-14 w-14 object-contain" />
          </div>
          <h1 className="text-2xl font-extrabold text-[var(--color-navy)]">Create your account</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">Join LabMind — your AI lab partner</p>
        </div>

        <form onSubmit={handleSignup} className="card space-y-4 p-6">
          {/* Role picker */}
          <div>
            <p className="mb-2 text-sm font-semibold text-[var(--color-navy)]">I am a…</p>
            <div className="grid grid-cols-2 gap-2">
              {(["student", "instructor"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-3 text-sm font-semibold transition ${
                    role === r
                      ? "border-[var(--color-brand)] bg-[var(--color-brand)]/8 text-[var(--color-brand)]"
                      : "border-black/10 text-[var(--color-muted)] hover:border-black/20"
                  }`}
                >
                  {r === "student" ? <GraduationCap size={20} /> : <BookOpen size={20} />}
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-semibold text-[var(--color-navy)]">
              Name <span className="font-normal text-[var(--color-muted)]">(optional)</span>
            </label>
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              className="input-base"
            />
          </div>

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
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 6 characters"
                required
                minLength={6}
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
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--color-brand)] py-3 font-semibold text-white disabled:opacity-40"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--color-muted)]">
          Already have an account?{" "}
          <Link href="/auth" className="font-semibold text-[var(--color-brand)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
