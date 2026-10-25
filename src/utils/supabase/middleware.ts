import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { Timer, withTiming } from "@/lib/server-timing";

export const updateSession = async (request: NextRequest) => {
  // Token-authenticated machine endpoints (the desktop widget). They have no
  // browser session, so the login redirect below would break them — and
  // there's no cookie to refresh. The route checks its own bearer token.
  // Same for creator nudges: the unsubscribe link (HMAC-signed) and the
  // scheduled automatic run (bearer NUDGE_SECRET).
  if (
    request.nextUrl.pathname.startsWith("/api/widget/") ||
    request.nextUrl.pathname.startsWith("/api/nudges/") ||
    // Cron-authenticated, no browser session to redirect.
    request.nextUrl.pathname.startsWith("/api/admin-push/")
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: just refresh the session cookies here. Don't redirect on missing
  // user — transient auth races during token refresh can briefly return null
  // and would log users out on every page refresh. The dashboard layout does
  // the actual auth gate with a proper retry-friendly check.
  // Timed because this is the single most expensive thing on the critical
  // path: measured against the deployed site, a bare /dashboard redirect
  // (middleware and nothing else) costs ~680ms against ~380ms for /login,
  // which does no Supabase work at all. That ~300ms is paid on EVERY
  // request, including every filter and sort click.
  const timer = new Timer();
  const {
    data: { user },
    error,
  } = await timer.span("auth_getUser", () => supabase.auth.getUser());

  // Public routes that don't require an authenticated session:
  // - /login              the login page itself
  // - /auth/...           Supabase invite + password-reset callback handler
  const isPublicRoute =
    request.nextUrl.pathname.startsWith("/login") ||
    request.nextUrl.pathname.startsWith("/auth/");

  // Only redirect on "definitely not logged in" (no user AND no auth error).
  // Auth errors usually mean the cookie is being refreshed mid-flight.
  if (!user && !error && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return withTiming(NextResponse.redirect(url), timer);
  }

  // If user is logged in and tries to access login, redirect to dashboard
  if (user && request.nextUrl.pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    return withTiming(NextResponse.redirect(url), timer);
  }

  return withTiming(supabaseResponse, timer);
};
