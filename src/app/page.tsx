"use client";

import { motion } from "framer-motion";
import {
  ArrowRight, Bot, Camera, CheckCircle2, ChevronRight,
  FlaskConical, LayoutDashboard, ShieldAlert, Sparkles,
  Star, Users, Zap,
} from "lucide-react";
import Link from "next/link";

const FEATURES = [
  { icon: FlaskConical, title: "Guided step-by-step protocols", body: "Every experiment broken into clear, ordered steps with the science explained in plain English." },
  { icon: Camera, title: "AI photo verification", body: "Students photograph readings. The AI checks them instantly — burette, gel, or colour change." },
  { icon: ShieldAlert, title: "Real-time safety engine", body: "Every reagent combination is checked before the student proceeds. Dangerous mixes are blocked." },
  { icon: Bot, title: "Interactive AI assistant", body: "Ask anything mid-experiment. The assistant plans, calls tools, and shows its reasoning." },
  { icon: LayoutDashboard, title: "Live instructor console", body: "Watch every student in real time. See safety alerts, vision fails, and agent decisions." },
  { icon: Sparkles, title: "Automatic report generation", body: "Complete lab reports — aim, observations, calculations, mistakes — generated instantly." },
];

const HOW_IT_WORKS = [
  { n: "01", role: "Instructor", title: "Create a session", body: "Upload your experiment PDF or pick from the library. A shareable code + QR is generated instantly." },
  { n: "02", role: "Students", title: "Join with the code", body: "Students enter the session code on any device — no app download needed." },
  { n: "03", role: "AI", title: "Guides each step", body: "LabMind walks through every step, flags safety issues, and answers questions live." },
  { n: "04", role: "Students", title: "Upload evidence", body: "Photo the burette, gel, or endpoint. AI reads and verifies the result immediately." },
  { n: "05", role: "Instructor", title: "Monitor in real time", body: "See progress, safety alerts, and AI decisions for every student simultaneously." },
  { n: "06", role: "AI", title: "Generate reports", body: "Full lab reports — with mistakes diagnosed and badges earned — ready in seconds." },
];

const INSTRUCTOR_BENEFITS = [
  "Spend lab time teaching, not policing",
  "Every student's progress visible at a glance",
  "Safety incidents flagged before harm occurs",
  "Reports auto-generated — no marking stack",
];

const STUDENT_BENEFITS = [
  "Never lose your place mid-experiment",
  "Instant AI answer for any 'what do I do next?' question",
  "Photos verified in seconds — no waiting for the instructor",
  "Learn from mistakes with specific, actionable feedback",
];

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-white font-sans text-[#0f2942]">
      {/* Nav */}
      <nav className="sticky top-0 z-40 flex items-center justify-between border-b border-black/8 bg-white/90 px-6 py-4 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl overflow-hidden shadow-sm">
            <img src="/logo2.png" alt="LabMind" className="h-9 w-9 object-contain" />
          </div>
          <span className="text-xl font-extrabold">LabMind</span>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/signup" className="rounded-lg px-4 py-2 text-sm font-semibold text-[#5b6b7d] hover:text-[#0f2942]">
            Sign in
          </Link>
          <Link href="/signup" className="rounded-lg bg-[#0f2942] px-4 py-2 text-sm font-semibold text-white hover:bg-[#14304f]">
            Get started free &rarr;
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0f2942] via-[#1c4f86] to-[#0c2138] px-6 py-24 text-white md:py-32">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_-20%,rgba(47,158,111,0.25),transparent_60%)]" />
        <div className="relative mx-auto max-w-4xl text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-sm font-semibold">
              <Zap size={14} className="text-yellow-300" /> Agentic AI &middot; Built for physical labs
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-tight md:text-6xl">
              The AI that watches your<br />
              <span className="bg-gradient-to-r from-[#2f9e6f] to-[#4ecca3] bg-clip-text text-transparent">
                experiment in real time.
              </span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-white/70">
              LabMind guides every step, reads your photos, blocks unsafe reagent mixes,
              and diagnoses your mistakes &mdash; before they happen.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/signup" className="inline-flex items-center gap-2 rounded-xl bg-[#2f9e6f] px-6 py-3.5 font-semibold text-white shadow-lg hover:brightness-110">
                I&apos;m an instructor <ArrowRight size={18} />
              </Link>
              <Link href="/signup" className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/10 px-6 py-3.5 font-semibold text-white backdrop-blur hover:bg-white/20">
                I&apos;m a student <ArrowRight size={18} />
              </Link>
            </div>
            <p className="mt-4 text-sm text-white/40">No sign-up required for the demo &middot; Works on any device</p>
          </motion.div>
        </div>
      </section>

      {/* Social proof strip */}
      <section className="border-b border-black/8 bg-[#f8fafc] px-6 py-4">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-6 text-sm text-[#5b6b7d]">
          {["3 experiments ready", "10 AI agent tools", "Real-time safety checks", "Auto PDF reports", "Zero setup"].map((t) => (
            <span key={t} className="flex items-center gap-1.5 font-semibold">
              <CheckCircle2 size={15} className="text-[#2f9e6f]" /> {t}
            </span>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-extrabold">Everything the lab needs. Nothing it doesn&apos;t.</h2>
            <p className="mt-3 text-[#5b6b7d]">Six AI-powered features that work together from first step to final report.</p>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-black/8 bg-white p-6 shadow-sm">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-[#2b6cb0]/10 text-[#2b6cb0]">
                  <f.icon size={22} />
                </div>
                <h3 className="font-bold">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[#5b6b7d]">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="bg-[#f8fafc] px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <div className="mb-12 text-center">
            <h2 className="text-3xl font-extrabold">How it works</h2>
            <p className="mt-3 text-[#5b6b7d]">From session creation to final report in 6 steps.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {HOW_IT_WORKS.map((s, i) => (
              <div key={i} className="relative rounded-2xl border border-black/8 bg-white p-6 shadow-sm">
                <span className="text-4xl font-extrabold text-[#2b6cb0]/15">{s.n}</span>
                <span className="ml-2 rounded-full bg-[#2f9e6f]/12 px-2 py-0.5 text-xs font-bold text-[#2f9e6f]">{s.role}</span>
                <h3 className="mt-2 font-bold">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[#5b6b7d]">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Benefits split */}
      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-2">
          <div className="rounded-2xl bg-gradient-to-br from-[#0f2942] to-[#1c4f86] p-8 text-white">
            <div className="mb-4 flex items-center gap-2">
              <LayoutDashboard size={20} />
              <h3 className="text-xl font-bold">For instructors</h3>
            </div>
            <ul className="space-y-3">
              {INSTRUCTOR_BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2 text-white/80">
                  <ChevronRight size={16} className="mt-0.5 shrink-0 text-[#2f9e6f]" /> {b}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white/15 px-4 py-2.5 text-sm font-semibold hover:bg-white/25">
              Create your first session <ArrowRight size={16} />
            </Link>
          </div>
          <div className="rounded-2xl border border-black/8 bg-white p-8 shadow-sm">
            <div className="mb-4 flex items-center gap-2 text-[#2b6cb0]">
              <Users size={20} />
              <h3 className="text-xl font-bold text-[#0f2942]">For students</h3>
            </div>
            <ul className="space-y-3">
              {STUDENT_BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2 text-[#5b6b7d]">
                  <ChevronRight size={16} className="mt-0.5 shrink-0 text-[#2f9e6f]" /> {b}
                </li>
              ))}
            </ul>
            <Link href="/signup" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#0f2942] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#14304f]">
              Join a session <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-gradient-to-br from-[#0f2942] to-[#1c4f86] px-6 py-20 text-center text-white">
        <div className="mx-auto max-w-2xl">
          <div className="mb-4 flex justify-center gap-1 text-yellow-300">
            {[...Array(5)].map((_, i) => <Star key={i} size={20} fill="currentColor" />)}
          </div>
          <h2 className="text-3xl font-extrabold">Ready to transform your lab?</h2>
          <p className="mt-3 text-white/70">No installation. No sign-up. Works on any device with a camera.</p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="rounded-xl bg-[#2f9e6f] px-6 py-3.5 font-semibold text-white shadow-lg hover:brightness-110">
              Start as instructor
            </Link>
            <Link href="/signup" className="rounded-xl border border-white/25 bg-white/10 px-6 py-3.5 font-semibold text-white backdrop-blur hover:bg-white/20">
              Join as student
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-black/8 px-6 py-6 text-center text-sm text-[#5b6b7d]">
        LabMind &middot; Team BitX &middot; Capgemini Exceller Agentify Buildathon 2026
      </footer>
    </div>
  );
}
