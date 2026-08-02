import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Privacy Policy — LabMind" };

const LAST_UPDATED = "August 2, 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-dvh bg-white px-6 py-12 font-sans text-[#0f2942]">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="mb-8 flex items-center gap-1.5 text-sm font-semibold text-[#5b6b7d] hover:text-[#0f2942]">
          <ArrowLeft size={15} /> Back to LabMind
        </Link>

        <h1 className="text-3xl font-extrabold">Privacy Policy</h1>
        <p className="mt-2 text-sm text-[#5b6b7d]">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-[#334155]">
          <p>
            LabMind ("we", "our") is a lab-assistant application that guides students through physical experiments,
            reads their photographed results with AI, and gives instructors a live view of their class. This policy
            explains what we collect, why, and the choices you have. It's written for the actual data LabMind
            handles — not a generic template.
          </p>

          <Section title="1. Who this applies to">
            <p>
              LabMind is used by students and instructors, typically through a school, college, or training
              programme. If you're a student under the age of majority in your jurisdiction, your school or
              instructor is responsible for any consent required to enrol you in a session that uses LabMind — we
              don't independently verify age and don't knowingly collect more data than the lab workflow needs.
              We don't run advertising and don't sell any data, to anyone, ever.
            </p>
          </Section>

          <Section title="2. What we collect">
            <List
              items={[
                <>
                  <strong>Account data:</strong> name, email address, a hashed (never plaintext) password, and your
                  role (student or instructor).
                </>,
                <>
                  <strong>Lab activity:</strong> the experiments you start, step completion timestamps, your typed
                  hypothesis and measured results, safety alerts triggered, and instructor verification decisions.
                </>,
                <>
                  <strong>Photos you submit for AI verification</strong> (e.g. a burette reading or gel image) —
                  used to check your result and, briefly, to detect duplicate/reused photos across a class.
                </>,
                <>
                  <strong>Class data (instructors):</strong> the session codes and names you create, and which
                  students joined them.
                </>,
                <>
                  <strong>Basic technical data:</strong> IP address, used only for short-lived rate-limiting on
                  login and join-code attempts to block brute-force abuse — not stored for tracking.
                </>,
              ]}
            />
          </Section>

          <Section title="3. How we use it">
            <p>
              To run the actual product: guide you through steps, grade your photographed results, show your
              instructor your progress and safety events, generate your lab report, and let your instructor review
              and export their own class's data. We do not use your data for advertising, and we do not build
              behavioral profiles beyond what's needed to show accuracy/progress stats back to you.
            </p>
          </Section>

          <Section title="4. Who we share it with">
            <p>Only the processors required to run the features you use, never for their own marketing purposes:</p>
            <List
              items={[
                <>
                  <strong>AI providers</strong> (OpenAI, Google Gemini, and/or Anthropic Claude, depending on which
                  is configured) — receive the photo or question you submit, to generate the vision-check result or
                  chat answer. If no provider is configured, LabMind runs in a deterministic demo mode that never
                  sends your data anywhere.
                </>,
                <>
                  <strong>Supabase</strong> — hosts our Postgres database (where your account and lab data lives).
                </>,
                <>
                  <strong>Vercel</strong> — hosts the application itself.
                </>,
              ]}
            />
            <p className="mt-2">We don't share data with any other third party, and never sell it.</p>
          </Section>

          <Section title="5. Instructor visibility">
            <p>
              An instructor can see the students and reports for classes <em>they</em> created — not any other
              instructor's classes, and not students who never joined their session code. If you think you're
              seeing data that isn't yours, that's a bug — please report it.
            </p>
          </Section>

          <Section title="6. Cookies">
            <p>
              LabMind sets one cookie: a signed session token used to keep you logged in. It's strictly necessary
              for the app to function and isn't used for tracking or advertising. We don't currently run any
              analytics or advertising cookies.
            </p>
          </Section>

          <Section title="7. How long we keep data">
            <p>
              We keep your account and lab data while your account is active. You can delete your account at any
              time from <Link href="/profile" className="text-[var(--color-brand)] underline">Profile → Delete account</Link>,
              which permanently removes your personal lab history. If you're an instructor, deleting your account
              detaches you from the classes you created rather than deleting your students' own records — their
              data belongs to them, not to you.
            </p>
          </Section>

          <Section title="8. Your rights">
            <p>You can, at any time, from your Profile page:</p>
            <List
              items={[
                <><strong>Access &amp; export</strong> a copy of your own data as a JSON file.</>,
                <><strong>Correct</strong> your display name.</>,
                <><strong>Delete</strong> your account and personal lab history.</>,
              ]}
            />
            <p className="mt-2">
              These map to the rights recognised under data-protection laws including India's Digital Personal Data
              Protection Act, 2023 and the EU/UK GDPR (access, correction, erasure, and portability). If you want
              something these self-service tools don't cover, contact us using the details below.
            </p>
          </Section>

          <Section title="9. Security">
            <p>
              Passwords are hashed with bcrypt, never stored in plaintext. Login and session-join attempts are
              rate-limited to slow brute-force guessing. Every instructor route checks that the requesting account
              actually owns the class being accessed before returning any data.
            </p>
          </Section>

          <Section title="10. Changes to this policy">
            <p>
              If we materially change what we collect or how we use it, we'll update the date at the top of this
              page. Continued use of LabMind after a change means you accept the update.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>
              Questions about this policy or your data: reach the team at{" "}
              <a href="mailto:harshitmakraria9@gmail.com" className="text-[var(--color-brand)] underline">
                harshitmakraria9@gmail.com
              </a>.
            </p>
          </Section>

          <p className="border-t border-black/8 pt-6 text-xs text-[#94a3b8]">
            This policy describes LabMind's actual data practices as implemented. It is not a substitute for legal
            advice — before using LabMind with real students at scale, have it reviewed by counsel familiar with
            your school's or institution's specific jurisdiction.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-lg font-bold text-[#0f2942]">{title}</h2>
      <div className="mt-2 space-y-2">{children}</div>
    </section>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}
