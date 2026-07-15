"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateInfluencer, uploadInfluencerPhoto } from "../actions";
import { ButtonSpinner, FullPageLoader } from "@/components/spinner";
import { MultiSelectChips } from "@/components/multi-select-chips";
import { INDIAN_CITIES, parseStoredCities } from "@/lib/cities";

const inputClass = "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";
const labelClass = "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5";

export function EditInfluencerButton({ influencer }: { influencer: any }) {
  const t = useTranslations("DashboardInfluencersIdEditInfluencer");
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
        {t("editButton")}
      </button>
      {open && <EditInfluencerModal influencer={influencer} onClose={() => setOpen(false)} />}
    </>
  );
}

function EditInfluencerModal({ influencer, onClose }: { influencer: any; onClose: () => void }) {
  const t = useTranslations("DashboardInfluencersIdEditInfluencer");
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(t("savingChanges"));
  const [error, setError] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string>(influencer.profile_photo_url || "");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Location is a scalar text column on influencer_profiles but rendered
  // as a multiselect. parseStoredCities keeps only tokens that are real
  // cities, so legacy free-text like "Mumbai, India" loads as ["Mumbai"]
  // (dropping the "India" token) instead of turning a country into an
  // unremovable phantom chip. Comma-join on save keeps the DB scalar valid.
  const [selectedCities, setSelectedCities] = useState<string[]>(
    parseStoredCities(influencer.location),
  );

  const handlePhotoSelect = (files: FileList | null) => {
    if (!files?.[0] || !files[0].type.startsWith("image/")) return;
    setPhotoFile(files[0]);
    setPhotoPreview(URL.createObjectURL(files[0]));
  };

  const handleSubmit = async (formData: FormData) => {
    setError("");
    setLoading(true);
    // Upload new photo first if selected
    if (photoFile) {
      setLoadingMsg(t("uploadingPhoto"));
      const fd = new FormData();
      fd.append("file", photoFile);
      fd.append("folder", "influencer-photos");
      const uploadResult = await uploadInfluencerPhoto(fd);
      if (uploadResult.error) { setError(uploadResult.error); setLoading(false); return; }
      if (uploadResult.url) formData.append("profile_photo_url", uploadResult.url);
    }
    setLoadingMsg(t("savingChanges"));
    // MultiSelectChips renders no form field, so this is the only thing
    // that puts location on the payload — comma-joined so the DB scalar
    // column stays valid and the downstream matcher finds each city.
    formData.set("location", selectedCities.join(", "));
    const result = await updateInfluencer(influencer.influencer_id, formData);
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
      {loading && <FullPageLoader message={loadingMsg} />}
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed z-50 inset-4 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-2xl lg:max-h-[85vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{t("modalTitle")}</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form action={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-gray-800 text-red-600 dark:text-red-400 text-sm">{error}</div>}

          {/* Profile photo */}
          <div className="flex items-center gap-5">
            <div
              onClick={() => fileRef.current?.click()}
              className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 flex items-center justify-center cursor-pointer transition-colors overflow-hidden bg-gray-50 dark:bg-gray-800 shrink-0"
            >
              {photoPreview ? (
                <img src={photoPreview} alt="" className="w-full h-full object-cover" />
              ) : (
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoSelect(e.target.files)} />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("profilePhoto")}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t("profilePhotoHint")}</p>
              {photoFile && <p className="text-[11px] text-emerald-600 mt-1">{t("newPhotoSelected")}</p>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>{t("fullName")}</label>
              <input name="full_name" type="text" defaultValue={influencer.full_name || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("username")}</label>
              <input name="username" type="text" defaultValue={influencer.username || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("instagramHandle")}</label>
              <input name="instagram_handle" type="text" defaultValue={influencer.instagram_handle || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("email")}</label>
              <input name="email" type="email" defaultValue={influencer.email || ""} className={inputClass} />
            </div>
            <div>
              <MultiSelectChips
                label={t("location")}
                options={INDIAN_CITIES}
                selected={selectedCities}
                onChange={setSelectedCities}
              />
            </div>
            <div>
              <label className={labelClass}>{t("gender")}</label>
              <select name="gender" defaultValue={influencer.gender || ""} className={inputClass}>
                <option value="">{t("genderNotSpecified")}</option>
                <option value="male">{t("genderMale")}</option>
                <option value="female">{t("genderFemale")}</option>
                <option value="other">{t("genderOther")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t("dateOfBirth")}</label>
              <input name="date_of_birth" type="date" defaultValue={influencer.date_of_birth || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>{t("status")}</label>
              <select name="status" defaultValue={influencer.status || "active"} className={inputClass}>
                <option value="active">{t("statusActive")}</option>
                <option value="suspended">{t("statusSuspended")}</option>
                <option value="pending">{t("statusPending")}</option>
                <option value="inactive">{t("statusInactive")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t("verification")}</label>
              <select name="verification_status" defaultValue={influencer.verification_status || ""} className={inputClass}>
                <option value="">{t("verificationNone")}</option>
                <option value="pending">{t("verificationPending")}</option>
                <option value="verified">{t("verificationVerified")}</option>
                <option value="rejected">{t("verificationRejected")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t("tier")}</label>
              <select name="tier" defaultValue={influencer.tier || ""} className={inputClass}>
                <option value="">{t("tierNone")}</option>
                <option value="nano">{t("tierNano")}</option>
                <option value="micro">{t("tierMicro")}</option>
                <option value="macro">{t("tierMacro")}</option>
                <option value="mega">{t("tierMega")}</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>{t("profileType")}</label>
              <select name="creator_type" defaultValue={influencer.creator_type || ""} className={inputClass}>
                <option value="">{t("profileTypeNotClassified")}</option>
                <option value="meme_page">{t("profileTypeMemePage")}</option>
                <option value="celebrity">{t("profileTypeCelebrity")}</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass}>{t("bio")}</label>
            <textarea name="bio" rows={3} defaultValue={influencer.bio || ""} className={`${inputClass} resize-none`} />
          </div>

          <div>
            <label className={labelClass}>{t.rich("categoriesLabel", { muted: (c) => <span className="text-gray-400 font-normal">{c}</span> })}</label>
            <input name="categories" type="text" defaultValue={influencer.categories?.join(", ") || ""} placeholder={t("categoriesPlaceholder")} className={inputClass} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-semibold transition-colors cursor-pointer">
              {loading && <ButtonSpinner />}{loading ? t("saving") : t("saveChanges")}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">{t("cancel")}</button>
          </div>
        </form>
      </div>
    </>
  );
}
