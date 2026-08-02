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
  const [instructorPasscode, setInstructorPasscode] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

  // Lightweight strength heuristic — length + character variety. Purely a UI
  // nudge (the server only enforces the 6-char minimum), matching the animated
  // strength bar in the design mockup.
  const strength = (() => {
    if (!password) return 0;
    let s = Math.min(1, password.length / 12) * 0.6;
    if (/[A-Z]/.test(password)) s += 0.12;
    if (/[0-9]/.test(password)) s += 0.14;
    if (/[^A-Za-z0-9]/.test(password)) s += 0.14;
    return Math.min(1, s);
  })();
  const strengthLabel = strength === 0 ? "" : strength < 0.4 ? "Weak" : strength < 0.75 ? "Good" : "Strong";
  const strengthColor = strength < 0.4 ? "var(--color-danger)" : strength < 0.75 ? "var(--color-warning)" : "var(--color-accent)";

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password || !role) return;
    if (password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (role === "instructor" && !instructorPasscode) { toast.error("Instructor passcode is required"); return; }
    setLoading(true);

    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role, instructor_passcode: instructorPasscode }),
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
      <div className="w-full max-w-sm overflow-hidden rounded-[1.4rem] shadow-[var(--shadow-pop)] anim-fade-up">
        <div className="hero-gradient px-7 py-8 text-white">
          <div className="anim-float mx-auto mb-3 flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-white/12 backdrop-blur">
            <img src="/logo2.png" alt="LabMind" className="h-14 w-14 object-contain" />
          </div>
          <h1 className="text-center text-2xl font-extrabold">Create your account</h1>
          <p className="mt-1 text-center text-sm text-white/70">Join LabMind — your AI lab partner</p>
        </div>

        <form onSubmit={handleSignup} className="space-y-4 bg-[var(--color-card)] px-7 py-7">
          {/* Role picker */}
          <div>
            <p className="mb-2 text-sm font-semibold text-[var(--color-navy)]">I am a…</p>
            <div className="grid grid-cols-2 gap-2">
              {(["student", "instructor"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border-2 py-3 text-sm font-semibold transition-all duration-150 active:scale-[0.98] ${
                    role === r
                      ? "border-[var(--color-brand)] bg-[var(--color-brand)]/8 text-[var(--color-brand)]"
                      : "border-black/10 text-[var(--color-muted)] hover:border-black/25 hover:bg-black/[0.02]"
                  }`}
                >
                  {r === "student" ? <GraduationCap size={20} /> : <BookOpen size={20} />}
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {role === "instructor" && (
            <div className="anim-fade-up">
              <label className="mb-1.5 block text-sm font-semibold text-[var(--color-navy)]">Instructor passcode</label>
              <input
                type="password"
                value={instructorPasscode}
                onChange={(e) => setInstructorPasscode(e.target.value)}
                placeholder="Provided by your institution"
                required
                className="input-base"
              />
            </div>
          )}

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
            {password && (
              <div className="anim-fade-up mt-2">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${strength * 100}%`, backgroundColor: strengthColor }} />
                </div>
                <p className="mt-1 text-xs" style={{ color: strengthColor }}>{strengthLabel} password</p>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password || (role === "instructor" && !instructorPasscode)}
            className="btn-secondary w-full"
          >
            {loading && <Loader2 size={18} className="animate-spin" />}
            {loading ? "Creating account…" : "Create account"}
          </button>

          <p className="text-center text-xs text-[var(--color-muted)]">
            By creating an account, you agree to LabMind&apos;s{" "}
            <Link href="/terms" className="text-[var(--color-brand)] hover:underline">Terms of Service</Link>
            {" "}and{" "}
            <Link href="/privacy" className="text-[var(--color-brand)] hover:underline">Privacy Policy</Link>.
          </p>
        </form>

        <p className="bg-[var(--color-card)] px-7 pb-7 text-center text-sm text-[var(--color-muted)]">
          Already have an account?{" "}
          <Link href="/auth" className="font-semibold text-[var(--color-brand)] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
