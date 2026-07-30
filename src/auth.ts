import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { PrismaAdapter } from "@auth/prisma-adapter";
import bcrypt from "bcryptjs";
import { db } from "@/server/db";
import { authConfig } from "@/auth.config";
import { rateLimit } from "@/server/rate-limit";

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: PrismaAdapter(db),
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const email = (credentials.email as string).toLowerCase();
        // Throttle per account, not just per IP, so a distributed brute-force
        // against one email still gets stopped even from many source IPs.
        if (!rateLimit(`signin:${email}`, 10, 5 * 60 * 1000)) return null;
        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });
        if (!user?.password) return null;
        const valid = await bcrypt.compare(
          credentials.password as string,
          user.password,
        );
        if (!valid) return null;
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          role: user.role as "instructor" | "student",
        };
      },
    }),
  ],
});
