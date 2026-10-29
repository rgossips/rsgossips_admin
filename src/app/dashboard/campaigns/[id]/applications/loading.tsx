// Shown while the applications list's server render is in flight.
//
// The click that lands here is "View all applications" on the campaign
// detail page. That page loads the campaign, counts every status, ranks each
// applicant against the brief and renders a rich row per application — on
// the campaign with 169 of them it is the slowest screen in the console, and
// until this existed the button looked like it had done nothing.
//
// The shape matches the real page (back link, title, status tabs, search,
// list card) so nothing shifts when the content lands.
export default function CampaignApplicationsLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-4 w-72 max-w-full bg-gray-100 dark:bg-gray-800/60 rounded" />
      <div className="h-7 w-44 bg-gray-200 dark:bg-gray-800 rounded-lg mt-3 mb-6" />

      {/* Status tabs — four cards, each a label over a count. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
            <div className="h-3 w-24 bg-gray-100 dark:bg-gray-800 rounded" />
            <div className="h-6 w-8 bg-gray-200 dark:bg-gray-700 rounded mt-3" />
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="flex gap-3 mb-5">
        <div className="h-11 flex-1 bg-gray-200 dark:bg-gray-800 rounded-xl" />
        <div className="h-11 w-24 bg-gray-200 dark:bg-gray-800 rounded-xl" />
      </div>

      {/* List */}
      <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
        <div className="flex items-center gap-2.5 border-b border-gray-100 dark:border-gray-800 px-6 py-4">
          <div className="h-8 w-8 bg-gray-200 dark:bg-gray-800 rounded-lg" />
          <div className="h-4 w-28 bg-gray-200 dark:bg-gray-800 rounded" />
          <div className="ml-auto flex items-center gap-3">
            <div className="h-7 w-28 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            <div className="h-7 w-32 bg-gray-100 dark:bg-gray-800 rounded-lg" />
          </div>
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-6 py-5 border-b border-gray-100 dark:border-gray-800 last:border-0">
            <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-800 shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <div className="h-4 w-40 bg-gray-200 dark:bg-gray-800 rounded" />
              <div className="h-3 w-64 max-w-full bg-gray-100 dark:bg-gray-800 rounded" />
            </div>
            <div className="hidden sm:flex items-center gap-2 shrink-0">
              <div className="h-7 w-28 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-7 w-24 bg-gray-100 dark:bg-gray-800 rounded-lg" />
              <div className="h-7 w-20 bg-gray-100 dark:bg-gray-800 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
