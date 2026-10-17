import { redirect } from "next/navigation";
import { isAdminOrAbove } from "@/lib/require-super-admin";
import { NotificationsFeed } from "@/components/notifications-feed";

// The feed reads live source tables through a gated server action, so it is
// always current — nothing to revalidate, and nothing to cache.
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  // Same gate as the streams behind it. The bell is in the shell for every
  // role, so the page it links to has to refuse on its own.
  if (!(await isAdminOrAbove())) redirect("/dashboard");
  return <NotificationsFeed />;
}
