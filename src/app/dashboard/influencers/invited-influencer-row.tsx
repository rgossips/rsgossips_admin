"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ButtonSpinner } from "@/components/spinner";
import { deleteInfluencerInvitation, updateInfluencerInvitation } from "./actions";
import { sendInfluencerInvitationEmail } from "./invitation-email-actions";
import { Avatar } from "@/components/avatar";
import { INDIAN_CITIES, parseStoredCities } from "@/lib/cities";
import { MultiSelectChips } from "@/components/multi-select-chips";
import { useRole } from "@/components/role-context";
import { SendInviteEmailModal } from "@/components/send-invite-email-modal";
import { InstagramLink } from "@/components/instagram-link";

interface Invitation {
  id: string;
  full_name: string;
  instagram_username: string;
  profile_photo_url: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

/**
 * The shape of the notes trailer, as measured across all 1,729 pending rows.
 *
 * Admin-curated keys and HikerAPI-enrichment keys land in the SAME object,
 * and every one is optional because the fill rates run from 97% down to 8%.
 * This is a description, not a guarantee — the value came out of JSON.parse
 * on a text column, so the panel still guards each field at runtime.
 */
type InvitationMeta = {
  // Admin-curated. Never written by enrichment (see CLAUDE.md).
  city?: string;
  gender?: string;
  creator_type?: string;
  categories?: string[];
  languages?: string[];
  tags?: string[];
  // Written by the HikerAPI enrichment.
  followers?: number;
  follows?: number;
  posts?: number;
  bio?: string;
  verified?: boolean;
  isPrivate?: boolean;
  businessCategory?: string;
  email?: string;
  externalUrl?: string;
  phone?: string;
};

function parseMeta(notes: string | null) {
  if (!notes) return { text: "", meta: null };
  const sep = notes.indexOf("\n---\n");
  const text = sep !== -1 ? notes.slice(0, sep) : (notes.startsWith("{") ? "" : notes);
  let meta: InvitationMeta | null = null;
  try { meta = JSON.parse(sep !== -1 ? notes.slice(sep + 5) : (notes.startsWith("{") ? notes : "")); } catch {}
  return { text, meta };
}

export function InvitedInfluencerRow({ invitation }: { invitation: Invitation }) {
  const t = useTranslations("DashboardInfluencersInvitedInfluencerRow");
  const { isAdmin } = useRole();
  const [loading, setLoading] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [details, setDetails] = useState(false);

  const handleDelete = async () => {
    if (!confirm(t("confirmRemove", { username: invitation.instagram_username }))) return;
    setLoading(true);
    const result = await deleteInfluencerInvitation(invitation.id);
    if (result.error) alert(result.error);
    else setRemoved(true);
    setLoading(false);
  };

  if (removed) return null;

  const { text, meta } = parseMeta(invitation.notes);

  return (
    <>
      {/* The whole card opens the details panel. It is a `role="button"`
          container rather than a real <button> wrapper because the card
          contains an <a> (InstagramLink) and two to three buttons of its
          own, and nesting those inside a button is invalid HTML — the same
          nesting rule CLAUDE.md records for InstagramLink. The interactive
          children stopPropagation so clicking Edit does not also open the
          panel behind the modal it just opened. */}
      <div
        role="button"
        tabIndex={0}
        aria-label={t("viewDetailsFor", { name: invitation.full_name })}
        onClick={() => setDetails(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setDetails(true);
          }
        }}
        className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-gray-900/50 hover:border-indigo-200 dark:hover:border-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 transition-all duration-300"
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar src={invitation.profile_photo_url} name={invitation.full_name} size="lg" shape="rounded" />
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{invitation.full_name}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500" onClick={(e) => e.stopPropagation()}>
                <InstagramLink handle={invitation.instagram_username} />
              </p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {t("awaitingClaim")}
          </span>
        </div>

        {(text || meta) && (
          <div className="mb-3 space-y-1.5">
            {text && <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{text}</p>}
            <div className="flex flex-wrap gap-1">
              {meta?.city && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] font-semibold">
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
                  {meta.city}
                </span>
              )}
              {meta?.categories?.map((c: string) => <span key={c} className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold">{c}</span>)}
              {meta?.languages?.map((l: string) => <span key={l} className="px-2 py-0.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-[10px] font-semibold">{l}</span>)}
              {meta?.tags?.map((t: string) => <span key={t} className="px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[10px] font-medium">#{t}</span>)}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{t("created", { date: new Date(invitation.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) })}</span>
          {isAdmin && (
            <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => setEmailing(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                {t("sendInvite")}
              </button>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-500 hover:text-indigo-600 cursor-pointer">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                {t("edit")}
              </button>
              <button onClick={handleDelete} disabled={loading} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:text-red-600 cursor-pointer disabled:opacity-50">
                {loading ? <ButtonSpinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                {t("remove")}
              </button>
            </div>
          )}
        </div>
      </div>

      {details && (
        <InvitationDetailsModal
          invitation={invitation}
          text={text}
          meta={meta}
          canWrite={isAdmin}
          onClose={() => setDetails(false)}
          onEdit={() => setEditing(true)}
          onSendInvite={() => setEmailing(true)}
        />
      )}
      {editing && <EditInfluencerInviteModal invitation={invitation} text={text} meta={meta} onClose={() => setEditing(false)} />}
      <SendInviteEmailModal
        open={emailing}
        onClose={() => setEmailing(false)}
        recipientLabel={t("recipientLabel", { name: invitation.full_name, username: invitation.instagram_username })}
        send={(email, customMessage) => sendInfluencerInvitationEmail(invitation.id, email, customMessage)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Details panel
//
// WHY THIS EXISTS. The card shows four of the fifteen things we hold about an
// invited creator. Measured across all 1,729 pending invitations, the notes
// trailer carries gender on 97%, categories 97%, languages 94%, followers /
// follows / posts 89%, verified 89%, isPrivate 88%, bio 87%, city 82%,
// business category 62%, external URL 61%, email 57% and a phone on 8% — and
// the card renders city, categories, languages and tags only. The rest is
// bought by the HikerAPI enrichment and then shown to nobody.
//
// It is a modal, not a route, because an invitation is NOT a profile:
// /dashboard/influencers/[id] reads influencer_profiles and would 404 on an
// invitation id. It also costs no query — the list already selects `notes`,
// so every field below is on the client before the card is clicked.
// ---------------------------------------------------------------------------

const nf = new Intl.NumberFormat("en-IN");

/** One labelled value. Renders nothing when there is nothing to say. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === "") return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="mt-0.5 text-[13px] text-gray-800 dark:text-gray-200 break-words">{children}</dd>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex-1 rounded-xl bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 text-center">
      <p className="text-sm font-bold text-gray-900 dark:text-white">
        {typeof value === "number" ? nf.format(value) : "—"}
      </p>
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
    </div>
  );
}

function Chips({ values, tone }: { values: string[]; tone: string }) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => (
        <span key={v} className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold ${tone}`}>{v}</span>
      ))}
    </div>
  );
}

function InvitationDetailsModal({
  invitation,
  text,
  meta,
  canWrite,
  onClose,
  onEdit,
  onSendInvite,
}: {
  invitation: Invitation;
  text: string;
  meta: InvitationMeta | null;
  canWrite: boolean;
  onClose: () => void;
  onEdit: () => void;
  onSendInvite: () => void;
}) {
  const t = useTranslations("DashboardInfluencersInvitedInfluencerRow");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const num = (v: unknown) => (typeof v === "number" ? v : null);
  // `verified` and `isPrivate` are booleans where FALSE is a real answer, not
  // a missing one — the enrichment writes them for every reachable account.
  // Testing truthiness would silently hide "this account is not verified".
  const isBool = (v: unknown) => typeof v === "boolean";

  const genderLabels: Record<string, string> = {
    female: t("genderFemale"),
    male: t("genderMale"),
    non_binary: t("genderNonBinary"),
    prefer_not_to_say: t("genderPreferNotToSay"),
  };
  const typeLabels: Record<string, string> = {
    meme_page: t("memePage"),
    celebrity: t("celebrity"),
  };

  const cats: string[] = Array.isArray(meta?.categories) ? meta.categories : [];
  const langs: string[] = Array.isArray(meta?.languages) ? meta.languages : [];
  const tags: string[] = Array.isArray(meta?.tags) ? meta.tags : [];
  const hasInstagramData =
    num(meta?.followers) !== null || !!meta?.bio || !!meta?.businessCategory || isBool(meta?.verified);
  const hasContact = meta?.email || meta?.phone || meta?.externalUrl;
  const hasCuration =
    meta?.city || meta?.gender || meta?.creator_type || cats.length > 0 || langs.length > 0 || tags.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("detailsTitle")}
        className="fixed z-50 inset-4 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-xl lg:max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
      >
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar src={invitation.profile_photo_url} name={invitation.full_name} size="lg" shape="rounded" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-gray-900 dark:text-white truncate">{invitation.full_name}</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">
                <InstagramLink handle={invitation.instagram_username} />
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {t("awaitingClaim")}
                </span>
                {meta?.verified === true && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-50 dark:bg-sky-900/20 text-sky-600 dark:text-sky-400">
                    {t("verifiedBadge")}
                  </span>
                )}
                {meta?.isPrivate === true && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                    {t("privateBadge")}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label={t("cancel")} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="flex gap-2">
            <Stat label={t("statFollowers")} value={num(meta?.followers)} />
            <Stat label={t("statFollowing")} value={num(meta?.follows)} />
            <Stat label={t("statPosts")} value={num(meta?.posts)} />
          </div>

          {!hasInstagramData && (
            <p className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-300">
              {t("notEnriched")}
            </p>
          )}

          {(meta?.bio || meta?.businessCategory) && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t("sectionAbout")}</h3>
              <dl className="space-y-3">
                {/* whitespace-pre-line: an Instagram bio is written with its
                    own line breaks and reads as nonsense collapsed to one. */}
                <Field label={t("bioLabel")}>
                  {meta?.bio ? <span className="whitespace-pre-line">{meta.bio}</span> : null}
                </Field>
                <Field label={t("businessCategoryLabel")}>{meta?.businessCategory || null}</Field>
              </dl>
            </section>
          )}

          {hasContact && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t("sectionContact")}</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("emailField")}>
                  {meta?.email ? (
                    <a href={`mailto:${meta.email}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{meta.email}</a>
                  ) : null}
                </Field>
                <Field label={t("phoneField")}>
                  {meta?.phone ? (
                    <a href={`tel:${String(meta.phone).replace(/[^+0-9]/g, "")}`} className="text-indigo-600 dark:text-indigo-400 hover:underline">{meta.phone}</a>
                  ) : null}
                </Field>
                <Field label={t("websiteField")}>
                  {meta?.externalUrl ? (
                    <a href={meta.externalUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline break-all">{meta.externalUrl}</a>
                  ) : null}
                </Field>
              </dl>
            </section>
          )}

          {hasCuration && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t("sectionCuration")}</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label={t("cityField")}>{meta?.city || null}</Field>
                <Field label={t("genderField")}>{meta?.gender ? genderLabels[meta.gender] || meta.gender : null}</Field>
                <Field label={t("creatorTypeField")}>{meta?.creator_type ? typeLabels[meta.creator_type] || meta.creator_type : null}</Field>
                {cats.length > 0 && (
                  <Field label={t("categoriesField")}>
                    <Chips values={cats} tone="bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400" />
                  </Field>
                )}
                {langs.length > 0 && (
                  <Field label={t("languagesField")}>
                    <Chips values={langs} tone="bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400" />
                  </Field>
                )}
                {tags.length > 0 && (
                  <Field label={t("tagsField")}>
                    <Chips values={tags.map((x) => `#${x}`)} tone="bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400" />
                  </Field>
                )}
              </dl>
            </section>
          )}

          {text && (
            <section>
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-400 mb-2">{t("sectionNote")}</h3>
              <p className="text-[13px] text-gray-700 dark:text-gray-300 whitespace-pre-line">{text}</p>
            </section>
          )}
        </div>

        {/* The actions follow into the panel, so reading the details is not a
            dead end you have to close before you can act on what you read. */}
        <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-gray-100 dark:border-gray-800">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">
            {t("created", { date: new Date(invitation.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) })}
          </span>
          {canWrite && (
            <div className="flex items-center gap-3">
              <button onClick={() => { onClose(); onSendInvite(); }} className="text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer">
                {t("sendInvite")}
              </button>
              <button onClick={() => { onClose(); onEdit(); }} className="text-[11px] font-semibold text-indigo-500 hover:text-indigo-600 cursor-pointer">
                {t("edit")}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

const inputClass = "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";

function EditInfluencerInviteModal({ invitation, text, meta, onClose }: { invitation: Invitation; text: string; meta: InvitationMeta | null; onClose: () => void }) {
  const t = useTranslations("DashboardInfluencersInvitedInfluencerRow");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // City is now a multiselect; comma-joined into the "city" form field
  // on submit so the server action (which reads formData.get("city"))
  // sees a single scalar string exactly like the invite form.
  // parseStoredCities keeps only known cities (shared parse owner).
  const [selectedCities, setSelectedCities] = useState<string[]>(
    parseStoredCities(typeof meta?.city === "string" ? meta.city : ""),
  );

  const handleSubmit = async (formData: FormData) => {
    setError(""); setLoading(true);
    formData.set("city", selectedCities.join(", "));
    const result = await updateInfluencerInvitation(invitation.id, formData);
    if (result.error) { setError(result.error); setLoading(false); }
    else { router.refresh(); onClose(); }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed z-50 inset-4 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-lg lg:max-h-[80vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{t("modalTitle")}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form action={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("fullNameLabel")}</label>
              <input name="full_name" required defaultValue={invitation.full_name} className={inputClass} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("instagramLabel")}</label>
              <input name="instagram_username" required defaultValue={invitation.instagram_username} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
              <div>
                <MultiSelectChips
                  label={t("cityLabel")}
                  options={INDIAN_CITIES}
                  selected={selectedCities}
                  onChange={setSelectedCities}
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("genderLabel")}</label>
                <select name="gender" defaultValue={meta?.gender || ""} className={`${inputClass} appearance-none`}>
                  <option value="">{t("selectGender")}</option>
                  <option value="female">{t("genderFemale")}</option>
                  <option value="male">{t("genderMale")}</option>
                  <option value="non_binary">{t("genderNonBinary")}</option>
                  <option value="prefer_not_to_say">{t("genderPreferNotToSay")}</option>
                </select>
              </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              {t.rich("profileTypeLabel", { opt: (c) => <span className="text-gray-400 font-normal">{c}</span> })}
            </label>
            <select
              name="creator_type"
              defaultValue={meta?.creator_type || ""}
              className={`${inputClass} appearance-none`}
            >
              <option value="">{t("notClassified")}</option>
              <option value="meme_page">{t("memePage")}</option>
              <option value="celebrity">{t("celebrity")}</option>
            </select>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t.rich("categoriesLabel", { opt: (c) => <span className="text-gray-400 font-normal">{c}</span> })}</label>
            <input name="categories_csv" defaultValue={meta?.categories?.join(", ") || ""} placeholder={t("categoriesPlaceholder")} className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t.rich("languagesLabel", { opt: (c) => <span className="text-gray-400 font-normal">{c}</span> })}</label>
            <input name="languages_csv" defaultValue={meta?.languages?.join(", ") || ""} placeholder={t("languagesPlaceholder")} className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t.rich("tagsLabel", { opt: (c) => <span className="text-gray-400 font-normal">{c}</span> })}</label>
            <input name="tags_csv" defaultValue={meta?.tags?.join(", ") || ""} placeholder={t("tagsPlaceholder")} className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("notesLabel")}</label>
            <input name="notes" defaultValue={text} className={inputClass} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-semibold cursor-pointer">
              {loading && <ButtonSpinner />}{loading ? t("saving") : t("save")}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm cursor-pointer">{t("cancel")}</button>
          </div>
        </form>
      </div>
    </>
  );
}
