"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateBrand, uploadBrandIcon } from "../actions";
import { ButtonSpinner } from "@/components/spinner";

const inputClass = "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";
const labelClass = "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5";

export function EditBrandButton({ brand }: { brand: any }) {
  const t = useTranslations("DashboardBrandsIdEditBrand");
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors cursor-pointer"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        {t("edit")}
      </button>
      {open && <EditBrandModal brand={brand} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditBrandModal({ brand, onClose }: { brand: any; onClose: () => void }) {
  const t = useTranslations("DashboardBrandsIdEditBrand");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [logoPreview, setLogoPreview] = useState<string>(brand.logo_url || "");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleLogoSelect = (files: FileList | null) => {
    if (!files || !files[0] || !files[0].type.startsWith("image/")) return;
    setLogoFile(files[0]);
    setLogoPreview(URL.createObjectURL(files[0]));
  };

  const handleSubmit = async (formData: FormData) => {
    setError("");
    setLoading(true);
    // Upload new logo if changed
    if (logoFile) {
      const fd = new FormData();
      fd.append("file", logoFile);
      fd.append("folder", "brand-logos");
      const uploadResult = await uploadBrandIcon(fd);
      if (uploadResult.error) { setError(uploadResult.error); setLoading(false); return; }
      if (uploadResult.url) formData.append("logo_url", uploadResult.url);
    }
    const result = await updateBrand(brand.brand_id, formData);
    if (result.error) {
      setError(result.error);
      setLoading(false);
    } else {
      router.refresh();
      onClose();
    }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed z-50 inset-4 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-2xl lg:max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t("title")}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form action={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">{error}</div>}

          {/* Logo Upload */}
          <div className="flex items-center gap-5">
            <div
              onClick={() => fileRef.current?.click()}
              className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 flex items-center justify-center cursor-pointer transition-colors overflow-hidden bg-gray-50 dark:bg-gray-800 shrink-0"
            >
              {logoPreview ? (
                <img src={logoPreview} alt={t("logoAlt")} className="w-full h-full object-cover" />
              ) : (
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleLogoSelect(e.target.files)} />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("brandLogo")}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("clickToChange")}</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t("brandName")}</label>
              <input name="brand_name" type="text" defaultValue={brand.brand_name || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("instagramUsername")}</label>
              <input name="instagram_username" type="text" defaultValue={brand.instagram_username || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("contactName")}</label>
              <input name="contact_name" type="text" defaultValue={brand.contact_name || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("contactRole")}</label>
              <input name="contact_role" type="text" defaultValue={brand.contact_role || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("contactEmail")}</label>
              <input name="contact_email" type="email" defaultValue={brand.contact_email || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("contactPhone")}</label>
              <input name="contact_phone" type="tel" defaultValue={brand.contact_phone || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("website")}</label>
              <input name="website_url" type="text" defaultValue={brand.website_url || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("gstin")}</label>
              <input name="gstin" type="text" defaultValue={brand.gstin || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("status")}</label>
              {/* Includes the user-initiated states (deactivated / pending
                  deletion) — without them a paused brand's real status fell
                  back to the first option and read as "Active". */}
              <select name="status" defaultValue={brand.status || "active"} className={inputClass}>
                <option value="active">{t("statusActive")}</option>
                <option value="inactive">{t("statusInactive")}</option>
                <option value="suspended">{t("statusSuspended")}</option>
                <option value="deactivated">{t("statusDeactivated")}</option>
                <option value="pending_deletion">{t("statusPendingDeletion")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t("verification")}</label>
              <select name="verification_status" defaultValue={brand.verification_status || "not_applied"} className={inputClass}>
                <option value="not_applied">{t("verifNotApplied")}</option>
                <option value="pending">{t("verifPending")}</option>
                <option value="verified">{t("verifVerified")}</option>
                <option value="rejected">{t("verifRejected")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t("tier")}</label>
              <select name="tier" defaultValue={brand.tier || ""} className={inputClass}>
                <option value="">{t("tierNone")}</option>
                <option value="bronze">{t("tierBronze")}</option>
                <option value="silver">{t("tierSilver")}</option>
                <option value="gold">{t("tierGold")}</option>
                <option value="platinum">{t("tierPlatinum")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t("listingType")}</label>
              <select name="listing_type" defaultValue={brand.listing_type || "free"} className={inputClass}>
                <option value="free">{t("listingFree")}</option>
                <option value="premium">{t("listingPremium")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t("monthlyBudgetRange")}</label>
              <input name="monthly_budget_range" type="text" defaultValue={brand.monthly_budget_range || ""} placeholder={t("monthlyBudgetPlaceholder")} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("preferredInfluencerTier")}</label>
              <input name="preferred_influencer_tier" type="text" defaultValue={brand.preferred_influencer_tier || ""} placeholder={t("preferredTierPlaceholder")} className={inputClass} />
            </div>
          </div>
          {/* Auto-approve: campaigns from this brand skip the admin review
              queue and publish straight to Active. */}
          <label className="flex items-start gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 cursor-pointer">
            <input
              type="checkbox"
              name="auto_approve_campaigns"
              defaultChecked={!!brand.auto_approve_campaigns}
              className="mt-0.5 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <span>
              <span className="block text-sm font-medium text-gray-800 dark:text-gray-200">{t("autoApprove")}</span>
              <span className="block text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("autoApproveHint")}</span>
            </span>
          </label>

          <div>
            <label className={labelClass}>{t("shortDescription")}</label>
            <input name="short_description" type="text" defaultValue={brand.short_description || ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>{t("fullDescription")}</label>
            <textarea name="full_description" rows={3} defaultValue={brand.full_description || ""} className={`${inputClass} resize-none`} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-semibold transition-colors cursor-pointer">
              {loading && <ButtonSpinner />}{loading ? t("saving") : t("saveChanges")}
            </button>
            <button type="button" onClick={onClose} disabled={loading} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer disabled:opacity-50">{t("cancel")}</button>
          </div>
        </form>
      </div>
    </>
  );
}
