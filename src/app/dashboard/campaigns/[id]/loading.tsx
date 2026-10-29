// Shown while anything under /dashboard/campaigns/[id] renders on the server.
//
// The click that most needed this is the back link on the applications list
// — that page reads the campaign, every application on it, the brand, the
// fulfilment state and the sourcing roster, so on a busy campaign the link
// sat on the old screen with no sign the click had registered. Next renders
// this the instant the navigation starts.
//
// Deliberately GENERIC rather than a pixel copy of the detail page: this one
// boundary also covers `edit`, `find-creators` and `sourcing`, none of which
// had a loader either, and a skeleton shaped like the detail page would be
// actively wrong on the edit form. Header, then cards, is true of all four.
// A route that wants a closer fit adds its own loading.tsx, the way
// `applications` does.
export default function CampaignSectionLoading() {
  return (
    <div className="max-w-6xl mx-auto animate-pulse">
      {/* Title row + action buttons */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="h-6 w-6 bg-gray-200 dark:bg-gray-800 rounded mt-1" />
          <div>
            <div className="h-7 w-80 max-w-full bg-gray-200 dark:bg-gray-800 rounded-lg" />
            <div className="h-4 w-64 max-w-full bg-gray-100 dark:bg-gray-800/50 rounded mt-3" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Widths are inline because Tailwind cannot build a class from a
              variable — `w-${n}` is never emitted. */}
          {[80, 112, 96, 136].map((w, i) => (
            <div key={i} className="h-10 bg-gray-200 dark:bg-gray-800 rounded-xl" style={{ width: w }} />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
              <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-800 px-6 py-4">
                <div className="h-8 w-8 bg-gray-200 dark:bg-gray-800 rounded-lg" />
                <div className="h-4 w-32 bg-gray-200 dark:bg-gray-800 rounded" />
                <div className="ml-auto h-7 w-28 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              </div>
              <div className="p-6 space-y-3">
                <div className="h-3 w-full bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-3 w-5/6 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-3 w-2/3 bg-gray-100 dark:bg-gray-800 rounded" />
              </div>
            </div>
          ))}
        </div>

        {/* Side rail */}
        <div className="space-y-6">
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 space-y-4">
            <div className="h-4 w-24 bg-gray-200 dark:bg-gray-800 rounded" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="h-3 w-24 bg-gray-100 dark:bg-gray-800 rounded" />
                <div className="h-3 w-16 bg-gray-200 dark:bg-gray-700 rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
