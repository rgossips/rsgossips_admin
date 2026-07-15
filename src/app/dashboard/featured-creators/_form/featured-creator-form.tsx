"use client";

import { useState, useTransition, useRef } from "react";
import { useTranslations } from "next-intl";
import { searchInfluencersForFeature, uploadFeaturedCreatorAvatar } from "../actions";

type Initial = {
  influencer_id?: string | null;
  username?: string;
  display_name?: string;
  avatar_url?: string;
  followers_label?: string;
  rating?: number | string | null;
  verified?: boolean;
  instagram_url?: string;
  position?: number;
  is_active?: boolean;
};

// Friendly "1.4M" / "23.5K" — matches the labels shown on the brand home page.
const formatFollowers = (n: number) => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export function FeaturedCreatorForm({
  action,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<{ error?: string }>;
  initial?: Initial;
  submitLabel: string;
}) {
  const t = useTranslations("DashboardFeaturedCreatorsFormFeaturedCreatorForm");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Local form state mirrors the eventual FormData fields. Useful for the
  // "Pick existing influencer" autofill flow.
  const [state, setState] = useState({
    influencer_id: initial?.influencer_id || "",
    username: initial?.username || "",
    display_name: initial?.display_name || "",
    avatar_url: initial?.avatar_url || "",
    followers_label: initial?.followers_label || "",
    rating: initial?.rating != null ? String(initial.rating) : "",
    verified: initial?.verified ?? false,
    instagram_url: initial?.instagram_url || "",
    position: initial?.position ?? 0,
    is_active: initial?.is_active ?? true,
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<any[]>([]);
  const [pickerSearching, setPickerSearching] = useState(false);

  // Avatar upload — pick a local file, upload to Supabase Storage on submit
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarSelect = (files: FileList | null) => {
    if (!files?.[0] || !files[0].type.startsWith("image/")) return;
    setAvatarFile(files[0]);
    // Show local preview immediately
    setState((prev) => ({ ...prev, avatar_url: URL.createObjectURL(files[0]) }));
  };

  const searchPicker = async (q: string) => {
    setPickerQuery(q);
    if (q.trim().length < 2) {
      setPickerResults([]);
      return;
    }
    setPickerSearching(true);
    const rows = await searchInfluencersForFeature(q);
    setPickerResults(rows);
    setPickerSearching(false);
  };

  const pickInfluencer = (inf: any) => {
    const handle = inf.instagram_handle || inf.username || "";
    setState((prev) => ({
      ...prev,
      influencer_id: inf.influencer_id,
      username: handle,
      display_name: inf.full_name || prev.display_name,
      avatar_url: inf.custom_profile_photo_url || inf.profile_photo_url || prev.avatar_url,
      followers_label: formatFollowers(inf.followers_count || 0) || prev.followers_label,
      instagram_url: handle ? `https://www.instagram.com/${handle}/` : prev.instagram_url,
    }));
    setPickerOpen(false);
    setPickerQuery("");
    setPickerResults([]);
  };

  const onSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      // Upload local avatar file (if picked) before saving the form
      if (avatarFile) {
        setAvatarUploading(true);
        const fd = new FormData();
        fd.append("file", avatarFile);
        const result = await uploadFeaturedCreatorAvatar(fd);
        setAvatarUploading(false);
        if (result.error) { setError(result.error); return; }
        if (result.url) {
          formData.set("avatar_url", result.url);
          setState((prev) => ({ ...prev, avatar_url: result.url! }));
        }
      }
      const res = await action(formData);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <form action={onSubmit} className="space-y-6">
      {/* Hidden mirror — keeps the server action receiving the chosen
          influencer_id without rendering it as a visible field. */}
      <input type="hidden" name="influencer_id" value={state.influencer_id} />

      {/* Pick existing */}
      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl p-4 flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">{t("pickExistingTitle")}</p>
          <p className="text-[12px] text-indigo-700 dark:text-indigo-300/80">{t("pickExistingHint")}</p>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold cursor-pointer"
        >
          {t("searchCreators")}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label={t("usernameLabel")} name="username" value={state.username} onChange={(v) => setState({ ...state, username: v.replace(/^@/, "") })} placeholder={t("usernamePlaceholder")} />
        <Field label={t("displayNameLabel")} name="display_name" value={state.display_name} onChange={(v) => setState({ ...state, display_name: v })} placeholder={t("displayNamePlaceholder")} />
      </div>

      {/* Hidden input so the form still submits the avatar_url field (filled by the picker / set after upload). */}
      <input type="hidden" name="avatar_url" value={state.avatar_url} />

      <div>
        <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{t("avatarLabel")}</span>
        <div className="mt-2 flex items-center gap-4">
          <div
            onClick={() => avatarInputRef.current?.click()}
            className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 flex items-center justify-center cursor-pointer transition-colors overflow-hidden bg-gray-50 dark:bg-gray-800 shrink-0"
          >
            {state.avatar_url ? (
              <img
                src={state.avatar_url}
                alt={t("avatarAlt")}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            ) : (
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            )}
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => handleAvatarSelect(e.target.files)}
          />
          <div>
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
            >
              {state.avatar_url ? t("changeAvatar") : t("uploadAvatar")}
            </button>
            <p className="text-[10px] text-gray-400 mt-1">{t("avatarHint")}</p>
            {avatarFile && <p className="text-[11px] text-emerald-600 mt-1">{t("avatarSelected")}</p>}
            {avatarUploading && <p className="text-[11px] text-indigo-600 mt-1">{t("uploading")}</p>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label={t("followersLabelLabel")} name="followers_label" value={state.followers_label} onChange={(v) => setState({ ...state, followers_label: v })} placeholder={t("followersPlaceholder")} />
        <Field label={t("ratingLabel")} name="rating" value={state.rating} onChange={(v) => setState({ ...state, rating: v })} placeholder={t("ratingPlaceholder")} type="number" step="0.1" />
        <Field label={t("positionLabel")} name="position" value={String(state.position)} onChange={(v) => setState({ ...state, position: Number(v) || 0 })} type="number" hint={t("positionHint")} />
      </div>

      <Field label={t("instagramUrlLabel")} name="instagram_url" value={state.instagram_url} onChange={(v) => setState({ ...state, instagram_url: v })} placeholder="https://www.instagram.com/cristiano/" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Toggle label={t("verifiedLabel")} name="verified" checked={state.verified} onChange={(v) => setState({ ...state, verified: v })} />
        <Toggle label={t("activeLabel")} name="is_active" checked={state.is_active} onChange={(v) => setState({ ...state, is_active: v })} />
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-sm font-semibold cursor-pointer"
        >
          {pending ? t("saving") : submitLabel}
        </button>
      </div>

      {pickerOpen && (
        <PickerDialog
          query={pickerQuery}
          onQueryChange={searchPicker}
          results={pickerResults}
          searching={pickerSearching}
          onPick={pickInfluencer}
          onClose={() => {
            setPickerOpen(false);
            setPickerQuery("");
            setPickerResults([]);
          }}
        />
      )}
    </form>
  );
}

function Field({
  label,
  name,
  value,
  onChange,
  placeholder,
  type = "text",
  step,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  step?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:focus:ring-indigo-900/30 outline-none"
      />
      {hint && <p className="text-[10px] text-gray-400 mt-1">{hint}</p>}
    </label>
  );
}

function Toggle({
  label,
  name,
  checked,
  onChange,
}: {
  label: string;
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-800">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded text-indigo-600 cursor-pointer"
      />
      <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</span>
    </label>
  );
}

function PickerDialog({
  query,
  onQueryChange,
  results,
  searching,
  onPick,
  onClose,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  results: any[];
  searching: boolean;
  onPick: (inf: any) => void;
  onClose: () => void;
}) {
  const t = useTranslations("DashboardFeaturedCreatorsFormFeaturedCreatorForm");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 w-[min(560px,95vw)] max-h-[85vh] flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <input
            type="text"
            autoFocus
            placeholder={t("searchPlaceholder")}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-indigo-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {searching ? (
            <div className="text-center text-sm text-gray-400 py-8">{t("searching")}</div>
          ) : results.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-8">
              {query.trim().length < 2 ? t("typeAtLeast") : t("noMatches")}
            </div>
          ) : (
            results.map((inf) => {
              const handle = inf.instagram_handle || inf.username || "—";
              const photo = inf.custom_profile_photo_url || inf.profile_photo_url;
              return (
                <button
                  key={inf.influencer_id}
                  type="button"
                  onClick={() => onPick(inf)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/20 text-left cursor-pointer"
                >
                  {photo ? (
                    <img src={photo} alt={handle} className="w-10 h-10 rounded-full object-cover" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs font-bold">
                      {handle.charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white truncate">{inf.full_name || handle}</p>
                    <p className="text-[12px] text-gray-500 truncate">@{handle} · {formatFollowers(inf.followers_count || 0) || "?"} {t("followers")}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
        <div className="p-3 border-t border-gray-100 dark:border-gray-800 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer"
          >
            {t("close")}
          </button>
        </div>
      </div>
    </div>
  );
}
