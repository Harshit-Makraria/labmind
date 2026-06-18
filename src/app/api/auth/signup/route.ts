import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/server/db";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { name, email, password, role } = await req.json();

  if (!email || !password || !role) {
    return NextResponse.json({ error: "Email, password and role are required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (!["instructor", "student"].includes(role)) {
    return NextResponse.json({ error: "Role must be instructor or student" }, { status: 400 });
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
