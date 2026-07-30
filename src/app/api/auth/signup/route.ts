import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { getConfig } from "@/server/config";
import { rateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!rateLimit(`signup:${ip}`, 10, 5 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many sign-up attempts. Try again in a few minutes." }, { status: 429 });
  }

  const { name, email, password, role, instructor_passcode } = await req.json();

  if (!email || !password || !role) {
    return NextResponse.json({ error: "Email, password and role are required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (!["instructor", "student"].includes(role)) {
    return NextResponse.json({ error: "Role must be instructor or student" }, { status: 400 });
  }
  // Instructor is a privileged role (class rosters, verification overrides,
  // shared LLM key settings) — gate it behind the same passcode the
  // dashboard already trusts, instead of letting the client pick any role.
  if (role === "instructor" && instructor_passcode !== getConfig().instructorPasscode) {
    return NextResponse.json({ error: "Incorrect instructor passcode" }, { status: 403 });
  }

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
  }

  const hashed = await bcrypt.hash(password, 12);
  const user = await db.user.create({
    data: { name: name || email.split("@")[0], email, password: hashed, role },
  });

  return NextResponse.json({ ok: true, id: user.id, email: user.email, role: user.role });
}
