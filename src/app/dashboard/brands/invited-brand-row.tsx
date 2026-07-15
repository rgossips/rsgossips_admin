"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ButtonSpinner } from "@/components/spinner";
import { deleteBrandInvitationStep, updateBrandInvitation } from "./invitation-actions";
import { BRAND_INVITATION_DELETE_STEPS } from "./delete-invitation-steps";
import { uploadBrandIcon } from "./actions";
import { sendBrandInvitationEmail } from "./invitation-email-actions";
import { CATEGORIES } from "@/lib/categories";
import { useRole } from "@/components/role-context";
import { SendInviteEmailModal } from "@/components/send-invite-email-modal";
import { DeleteWithStepsModal } from "@/components/delete-with-steps-modal";

interface Invitation {
  id: string;
  brand_name: string;
  instagram_username: string;
  logo_url: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

function parseMeta(notes: string | null) {
  if (!notes) return { text: "", meta: null };
  const sep = notes.indexOf("\n---\n");
  const text = sep !== -1 ? notes.slice(0, sep) : (notes.startsWith("{") ? "" : notes);
  let meta: any = null;
  try { meta = JSON.parse(sep !== -1 ? notes.slice(sep + 5) : (notes.startsWith("{") ? notes : "")); } catch {}
  return { text, meta };
}

export function InvitedBrandRow({ invitation }: { invitation: Invitation }) {
  const t = useTranslations("DashboardBrandsInvitedBrandRow");
  const router = useRouter();
  const { isAdmin } = useRole();
  const [removed, setRemoved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (removed) return null;

  const { text, meta } = parseMeta(invitation.notes);

  return (
    <>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-gray-900/50 transition-all duration-300">
        <Link href={`/dashboard/brands/${invitation.id}`} className="block mb-4">
          <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {invitation.logo_url ? (
              <img src={invitation.logo_url} alt="" className="w-11 h-11 rounded-xl object-cover border border-gray-200 dark:border-gray-700" />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center">
                <span className="text-sm font-bold text-white">{invitation.brand_name[0]?.toUpperCase()}</span>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{invitation.brand_name}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">@{invitation.instagram_username}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {t("awaitingClaim")}
          </span>
          </div>
        </Link>

        {(text || meta) && (
          <div className="mb-3 space-y-1.5">
            {text && <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{text}</p>}
            {meta?.category && <span className="inline-flex px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold">{meta.category}</span>}
            {meta?.instagram_verified && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[10px] font-semibold ml-1">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                {t("verified")}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">{t("created", { date: new Date(invitation.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) })}</span>
          {isAdmin && (
            <div className="flex items-center gap-3">
              <button onClick={() => setEmailing(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                {t("sendInvite")}
              </button>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-500 hover:text-indigo-600 cursor-pointer">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                {t("edit")}
              </button>
              <button onClick={() => setRemoving(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:text-red-600 cursor-pointer">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                {t("remove")}
              </button>
            </div>
          )}
        </div>
      </div>

      {editing && <EditBrandInviteModal invitation={invitation} text={text} meta={meta} onClose={() => setEditing(false)} />}
      <SendInviteEmailModal
        open={emailing}
        onClose={() => setEmailing(false)}
        recipientLabel={`${invitation.brand_name} (@${invitation.instagram_username})`}
        send={(email, customMessage) => sendBrandInvitationEmail(invitation.id, email, customMessage)}
      />
      <DeleteWithStepsModal
        open={removing}
        onClose={() => setRemoving(false)}
        title={t("removeInvitationTitle", { username: invitation.instagram_username })}
        subtitle={invitation.brand_name}
        confirmLabel={t("removeInvitation")}
        bullets={[
          t("bulletCampaigns"),
          t("bulletApplications"),
          t("bulletFeaturedListings"),
          t("bulletInvitationItself"),
        ]}
        steps={BRAND_INVITATION_DELETE_STEPS.map((s) => ({ key: s.key, label: s.label }))}
        runStep={(key) => deleteBrandInvitationStep(invitation.id, key as never)}
        onDone={() => {
          setRemoved(true);
          router.refresh();
        }}
      />
    </>
  );
}

const inputClass = "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";

function EditBrandInviteModal({ invitation, text, meta, onClose }: { invitation: Invitation; text: string; meta: any; onClose: () => void }) {
  const t = useTranslations("DashboardBrandsInvitedBrandRow");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Tracks edits to the logo independently. `logoChanged` distinguishes
  // "untouched, leave the DB value alone" from "explicitly cleared",
  // and matches the contract in [[updateBrandInvitation]] (an empty
  // string clears, a missing field is ignored).
  const [logoPreview, setLogoPreview] = useState<string>(invitation.logo_url || "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoChanged, setLogoChanged] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleLogoSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    if (logoPreview && logoFile) URL.revokeObjectURL(logoPreview);
    setLogoFile(file);
    setLogoPreview(URL.createObjectURL(file));
    setLogoChanged(true);
  };

  const removeLogo = () => {
    if (logoPreview && logoFile) URL.revokeObjectURL(logoPreview);
    setLogoFile(null);
    setLogoPreview("");
    setLogoChanged(true);
    if (logoInputRef.current) logoInputRef.current.value = "";
  };

  const handleSubmit = async (formData: FormData) => {
    setError(""); setLoading(true);
    try {
      if (logoChanged) {
        let url = "";
        if (logoFile) {
          const fd = new FormData();
          fd.append("file", logoFile);
          fd.append("folder", "brand-icons");
          const upload = await uploadBrandIcon(fd);
          if (upload.error) {
            setError(upload.error);
            setLoading(false);
            return;
          }
          url = upload.url || "";
        }
        // Pass empty string when the admin cleared the logo so the
        // server knows to null it out vs. leaving the field untouched.
        formData.set("logo_url", url);
      }
      const result = await updateBrandInvitation(invitation.id, formData);
      if (result.error) { setError(result.error); setLoading(false); }
      else { router.refresh(); onClose(); }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("somethingWentWrong"));
      setLoading(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed z-50 inset-4 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-lg lg:max-h-[80vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">{t("editBrandInvitation")}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form action={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 text-sm">{error}</div>}

          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("brandLogo")}</label>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 flex items-center justify-center cursor-pointer overflow-hidden bg-gray-50 dark:bg-gray-800 shrink-0"
              >
                {logoPreview ? (
                  <img src={logoPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                )}
              </button>
              <input
                ref={logoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleLogoSelect(e.target.files)}
              />
              <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                <p>{logoPreview ? t("clickToChangeLogo") : t("clickToUploadLogo")}</p>
                {logoPreview && (
                  <button type="button" onClick={removeLogo} className="text-red-500 hover:text-red-600 cursor-pointer">
                    {t("removeLogo")}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("brandNameLabel")}</label>
              <input name="brand_name" required defaultValue={invitation.brand_name} className={inputClass} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("instagramLabel")}</label>
              <input name="instagram_username" required defaultValue={invitation.instagram_username} className={inputClass} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("category")}</label>
              <select name="category" defaultValue={meta?.category || ""} className={inputClass}>
                <option value="">{t("none")}</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("instagramVerified")}</label>
              <div className="flex items-center gap-4 h-[42px]">
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="instagram_verified" value="yes" defaultChecked={meta?.instagram_verified === true} className="text-indigo-600" /><span className="text-sm text-gray-700 dark:text-gray-300">{t("yes")}</span></label>
                <label className="flex items-center gap-2 cursor-pointer"><input type="radio" name="instagram_verified" value="no" defaultChecked={!meta?.instagram_verified} className="text-indigo-600" /><span className="text-sm text-gray-700 dark:text-gray-300">{t("no")}</span></label>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">{t("notes")}</label>
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
