import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: { signIn: "/auth", error: "/auth" },
  // Explicit rather than relying on NextAuth's default: a session should
  // stay signed in until the user hits Sign out or 30 days pass, not until
  // some framework default quietly changes underneath us. updateAge keeps
  // the JWT's expiry sliding forward on activity, so an actively-used
  // session doesn't hit the 30-day wall mid-lab-session either.
  session: { strategy: "jwt" as const, maxAge: 30 * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user;
      const pub = ["/auth", "/signup", "/"].some(
        (p) => nextUrl.pathname === p || nextUrl.pathname.startsWith(p + "?"),
      );
      if (pub) return true;
      if (!isLoggedIn) return Response.redirect(new URL("/auth", nextUrl));
      return true;
    },
    jwt({ token, user }) {
      if (user) {
        token.id = user.id!;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        token.role = (user as any).role ?? "student";
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.id as string;
      session.user.role = token.role as "instructor" | "student";
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
