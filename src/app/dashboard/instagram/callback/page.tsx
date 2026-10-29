import { redirect } from "next/navigation";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { CallbackHandoff } from "./handoff";

export const dynamic = "force-dynamic";

// Where Instagram sends the admin back after they authorise.
//
// A page under /dashboard rather than a route handler, for two reasons: the
// admin arriving here already has a session (the middleware would redirect a
// stranger, which is right), and the redirect_uri has to be a URL a browser
// can land on and read, not an API endpoint.
//
// The exchange itself happens in a client component calling a server action,
// because the `redirect_uri` sent to Instagram must be byte-identical to the
// one used in the token exchange, and the only thing that knows the origin
// the admin actually used is the browser. A server-side `getSiteUrl()` would
// be right in production and wrong on localhost — exactly the case someone
// is testing in.

export default async function InstagramCallbackPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; error_description?: string }>;
}) {
  if (!(await isAdminOrAbove())) redirect("/dashboard");
  const params = await searchParams;

  // The admin pressed Cancel on Instagram's screen, or Meta refused.
  if (params.error || !params.code) {
    return (
      <div className="mx-auto max-w-lg space-y-3 py-16 text-center">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Instagram did not connect</h1>
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          {params.error_description || params.error || "No authorisation code came back."}
        </p>
        <a
          href="/dashboard/instagram"
          className="inline-block rounded-xl bg-indigo-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-indigo-500"
        >
          Back to Instagram messages
        </a>
      </div>
    );
  }

  return <CallbackHandoff code={params.code} />;
}
