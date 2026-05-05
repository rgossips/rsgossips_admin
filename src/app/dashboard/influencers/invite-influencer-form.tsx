"use client";

import { useState, useRef, useEffect } from "react";
import { inviteInfluencer, uploadInfluencerPhoto } from "./actions";
import { ButtonSpinner, FullPageLoader } from "@/components/spinner";

import { CATEGORIES } from "@/lib/categories";
import { INDIAN_CITIES } from "@/lib/cities";

const LANGUAGES = [
  "English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam",
  "Bengali", "Marathi", "Gujarati", "Punjabi", "Odia", "Urdu",
];

const inputClass = "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";
const labelClass = "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5";

function MultiSelectChips({ label, options, selected, onChange }: { label: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div ref={ref} className="relative">
      <label className={labelClass}>{label}</label>
      <button type="button" onClick={() => setOpen(!open)} className={`${inputClass} text-left flex items-center justify-between cursor-pointer`}>
        <span className={selected.length > 0 ? "text-gray-900 dark:text-white" : "text-gray-400"}>
          {selected.length > 0 ? `${selected.length} selected` : `Select ${label.toLowerCase()}`}
        </span>
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[11px] font-semibold">
              {v}
              <button type="button" onClick={() => toggle(v)} className="hover:text-indigo-800 cursor-pointer">&times;</button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-48 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1">
          {options.map((opt) => (
            <label key={opt} className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer text-sm text-gray-700 dark:text-gray-300">
              <input type="checkbox" checked={selected.includes(opt)} onChange={() => toggle(opt)} className="rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500" />
              {opt}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

function TagInput({ tags, onChange }: { tags: string[]; onChange: (t: string[]) => void }) {
  const [input, setInput] = useState("");
  const add = () => { const v = input.trim(); if (v && !tags.includes(v)) { onChange([...tags, v]); setInput(""); } };
  return (
    <div>
      <label className={labelClass}>Tags</label>
      <div className={`${inputClass} flex flex-wrap items-center gap-1.5 min-h-[42px] !py-1.5 !px-2.5`}>
        {tags.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-[11px] font-semibold">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="hover:text-red-500 cursor-pointer">&times;</button>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }}
          onBlur={add}
          placeholder={tags.length === 0 ? "Type and press Enter" : ""}
          className="flex-1 min-w-[80px] bg-transparent outline-none text-sm text-gray-900 dark:text-white placeholder-gray-400"
        />
      </div>
    </div>
  );
}

export function InviteInfluencerForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const handlePhotoSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (formData: FormData) => {
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (photoFile) {
        setLoadingMsg("Uploading photo...");
        const fd = new FormData();
        fd.append("file", photoFile); fd.append("folder", "influencer-photos");
        const uploadResult = await uploadInfluencerPhoto(fd);
        if (uploadResult.error) { setError(uploadResult.error); setLoading(false); return; }
        if (uploadResult.url) formData.append("profile_photo_url", uploadResult.url);
      }
      selectedCategories.forEach((c) => formData.append("categories", c));
      selectedLanguages.forEach((l) => formData.append("languages", l));
      tags.forEach((t) => formData.append("tags", t));

      setLoadingMsg("Creating invitation...");
      const result = await inviteInfluencer(formData);
      if (result.error) { setError(result.error); } else {
        setSuccess("Influencer invitation created!");
        setOpen(false); setPhotoFile(null); setPhotoPreview(null);
        setSelectedCategories([]); setSelectedLanguages([]); setTags([]);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); }
    setLoading(false);
  };

  const reset = () => { setOpen(false); setError(""); setPhotoFile(null); setPhotoPreview(null); setSelectedCategories([]); setSelectedLanguages([]); setTags([]); };

  return (
    <div className="mb-6">
      {loading && <FullPageLoader message={loadingMsg} />}
      {success && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 text-sm mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          {success}
        </div>
      )}
      {!open ? (
        <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-200/50 dark:shadow-indigo-900/30 cursor-pointer">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
          Invite Influencer
        </button>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" /></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Invite Influencer</h3>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">Create a placeholder — influencer will claim it via Instagram login</p>
              </div>
            </div>
          </div>
          {error && <div className="mx-6 mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">{error}</div>}
          <form action={handleSubmit} className="p-6 space-y-5">
            {/* Row 1: Photo + Name/Username */}
            <div className="flex items-start gap-6">
              <div className="shrink-0">
                <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-2">Photo</p>
                <div onClick={() => fileRef.current?.click()} className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 flex items-center justify-center cursor-pointer transition-colors overflow-hidden bg-gray-50 dark:bg-gray-800">
                  {photoPreview ? <img src={photoPreview} alt="" className="w-full h-full object-cover" /> : <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}
                </div>
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => handlePhotoSelect(e.target.files)} />
              </div>
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Full Name <span className="text-red-400">*</span></label>
                  <input name="full_name" type="text" required placeholder="e.g. Priya Sharma" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Instagram Username <span className="text-red-400">*</span></label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                    <input name="instagram_username" type="text" required placeholder="priyasharma" className={`${inputClass} !pl-8`} />
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: City + Gender */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>City <span className="text-red-400">*</span></label>
                <select name="city" required defaultValue="" className={`${inputClass} appearance-none`}>
                  <option value="" disabled>Select a city</option>
                  {INDIAN_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelClass}>Gender <span className="text-red-400">*</span></label>
                <select name="gender" required defaultValue="" className={`${inputClass} appearance-none`}>
                  <option value="" disabled>Select gender</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="non_binary">Non-binary</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
            </div>

            {/* Row 3: Categories + Languages */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <MultiSelectChips label="Categories" options={CATEGORIES} selected={selectedCategories} onChange={setSelectedCategories} />
              <MultiSelectChips label="Content Language" options={LANGUAGES} selected={selectedLanguages} onChange={setSelectedLanguages} />
            </div>

            {/* Row 3: Tags + Notes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TagInput tags={tags} onChange={setTags} />
              <div>
                <label className={labelClass}>Notes <span className="text-gray-400 font-normal">(optional)</span></label>
                <input name="notes" type="text" placeholder="e.g. Contacted via DM" className={inputClass} />
              </div>
            </div>

            {/* Info box */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30">
              <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <div className="text-[12px] text-blue-700 dark:text-blue-300 leading-relaxed">
                <p className="font-semibold mb-1">How this works:</p>
                <ol className="list-decimal ml-4 space-y-0.5 text-blue-600 dark:text-blue-400">
                  <li>You create an invitation with the influencer&apos;s Instagram handle</li>
                  <li>Influencer opens RecentGossips app and connects their Instagram</li>
                  <li>If the handle matches, they see a &quot;Complete your profile&quot; screen</li>
                  <li>Influencer verifies their phone and the account becomes active</li>
                </ol>
              </div>
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-semibold transition-colors cursor-pointer">
                {loading && <ButtonSpinner />}{loading ? "Creating..." : "Create Invitation"}
              </button>
              <button type="button" onClick={reset} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium transition-colors cursor-pointer">Cancel</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
