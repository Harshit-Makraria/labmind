import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: { signIn: "/auth", error: "/auth" },
  session: { strategy: "jwt" as const },
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
