import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = { title: "Terms of Service — LabMind" };

const LAST_UPDATED = "August 2, 2026";

export default function TermsPage() {
  return (
    <div className="min-h-dvh bg-white px-6 py-12 font-sans text-[#0f2942]">
      <div className="mx-auto max-w-3xl">
        <Link href="/" className="mb-8 flex items-center gap-1.5 text-sm font-semibold text-[#5b6b7d] hover:text-[#0f2942]">
          <ArrowLeft size={15} /> Back to LabMind
        </Link>

        <h1 className="text-3xl font-extrabold">Terms of Service</h1>
        <p className="mt-2 text-sm text-[#5b6b7d]">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-8 text-[15px] leading-relaxed text-[#334155]">
          <p>
            These terms cover your use of LabMind. By creating an account or joining a session, you agree to them.
          </p>

          <Section title="1. What LabMind is — and isn't">
            <p>
              LabMind guides you through physical lab experiments, checks photographed results with AI, and flags
              reagent combinations that are commonly unsafe. It is a learning aid, not a certified safety system and
              not a replacement for your instructor, your institution's safety rules, or your own judgement.{" "}
              <strong>Always follow your lab's actual safety protocols and your instructor's instructions</strong> —
              LabMind's safety checks are a helpful second layer, not the authority.
            </p>
          </Section>

          <Section title="2. Accounts">
            <p>
              You need an account to use LabMind. You're responsible for keeping your password secure and for
              activity under your account. Instructor accounts require a passcode set by whoever administers your
              deployment of LabMind — it exists to keep the instructor role from being self-assigned by anyone who
              signs up, not as a payment gate.
            </p>
          </Section>

          <Section title="3. Acceptable use">
            <p>You agree not to:</p>
            <List
              items={[
                "Submit someone else's photo or work as your own — LabMind's duplicate-photo detection and pacing analysis exist specifically to catch this, and instructors see the result.",
                "Attempt to access another instructor's classes or another student's session without authorization.",
                "Use LabMind to bypass or misrepresent a real safety procedure your institution requires.",
                "Attempt to disrupt, overload, or reverse-engineer the service.",
              ]}
            />
          </Section>

          <Section title="4. AI-generated content">
            <p>
              Vision checks, chat answers, and generated reports are produced by AI models (or, when no provider is
              configured, a deterministic demo heuristic) and can be wrong. Treat every AI reading, safety flag, and
              report as a draft to verify, not a certified result — especially for anything safety-related.
            </p>
          </Section>

          <Section title="5. Your content">
            <p>
              You keep ownership of the photos, hypotheses, and results you submit. By submitting a photo for
              verification, you give LabMind permission to process it (including sending it to the configured AI
              provider) solely to run that check — see the{" "}
              <Link href="/privacy" className="text-[var(--color-brand)] underline">Privacy Policy</Link> for detail.
              We don't use your submissions to train models or for any purpose beyond running the feature you used
              it for.
            </p>
          </Section>

          <Section title="6. Instructor responsibilities">
            <p>
              If you create sessions and enrol students, you're responsible for having whatever authorization your
              institution requires to do so, and for the accuracy of the class/session information you enter. You
              can only see and manage classes you created yourself.
            </p>
          </Section>

          <Section title="7. Availability">
            <p>
              LabMind is provided "as is." We aim for it to work reliably but don't guarantee uninterrupted access —
              treat it as a tool that assists your lab work, not the sole record of it, especially for anything
              graded or safety-critical.
            </p>
          </Section>

          <Section title="8. Termination">
            <p>
              You can delete your account at any time from your Profile page. We may suspend an account that
              violates the acceptable-use terms above.
            </p>
          </Section>

          <Section title="9. Changes">
            <p>We'll update the date at the top of this page if these terms change materially.</p>
          </Section>

          <Section title="10. Contact">
            <p>
              Questions:{" "}
              <a href="mailto:harshitmakraria9@gmail.com" className="text-[var(--color-brand)] underline">
                harshitmakraria9@gmail.com
              </a>.
            </p>
          </Section>

          <p className="border-t border-black/8 pt-6 text-xs text-[#94a3b8]">
            These terms describe LabMind as it actually operates today. They are not a substitute for legal advice —
            before deploying LabMind for real coursework or grading, have these terms reviewed by counsel for your
            institution's jurisdiction.
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
