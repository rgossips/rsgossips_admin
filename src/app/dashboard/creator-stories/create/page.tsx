import Link from "next/link";
import { CreatorStoryForm } from "../_form/creator-story-form";
import { createCreatorStory } from "../actions";

export default function CreateCreatorStoryPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/creator-stories"
          className="text-[12px] font-semibold text-indigo-600 hover:underline"
        >
          ← Creator Stories
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">New story</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Upload a short vertical clip — it appears in the Top Creator Stories carousel on the brand home page.
        </p>
      </div>

      <CreatorStoryForm action={createCreatorStory} submitLabel="Publish" />
    </div>
  );
}
