"use client";

import { useState, useRef } from "react";
import { inviteBrand, uploadBrandIcon } from "./actions";
import { ButtonSpinner } from "@/components/spinner";
import { FullPageLoader } from "@/components/spinner";
import { CATEGORIES } from "@/lib/categories";
import { BulkInviteBrands } from "./bulk-invite-brands";

export function AddBrandForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [iconFile, setIconFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleIconSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    if (iconPreview) URL.revokeObjectURL(iconPreview);
    setIconFile(file);
    setIconPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (formData: FormData) => {
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      // Upload icon if selected
      if (iconFile) {
        setLoadingMsg("Uploading brand icon...");
        const fd = new FormData();
        fd.append("file", iconFile);
        fd.append("folder", "brand-icons");
        const uploadResult = await uploadBrandIcon(fd);
        if (uploadResult.error) {
          setError(uploadResult.error);
          setLoading(false);
          return;
        }
        if (uploadResult.url) {
          formData.append("logo_url", uploadResult.url);
        }
      }

      setLoadingMsg("Creating brand invitation...");
      const result = await inviteBrand(formData);

      if (result.error) {
        setError(result.error);
      } else {
        setSuccess("Brand invitation created! The brand can now sign up via Instagram.");
        setOpen(false);
        setIconFile(null);
        setIconPreview(null);
        if (fileRef.current) fileRef.current.value = "";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
    setLoading(false);
  };

  return (
    <div className="mb-6">
      {loading && <FullPageLoader message={loadingMsg} />}

      {success && (
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-900/30 border border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 text-sm mb-4 flex items-center gap-2">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {success}
        </div>
      )}

      {!open ? (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-sm font-semibold transition-all shadow-lg shadow-indigo-200/50 dark:shadow-indigo-900/30 cursor-pointer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            Invite Brand
          </button>
          <BulkInviteBrands />
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Invite New Brand</h3>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  Create a placeholder — brand will claim it via Instagram login
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-6 mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          <form action={handleSubmit} className="p-6 space-y-5">
            <div className="flex items-start gap-6">
              {/* Icon Upload */}
              <div className="shrink-0">
                <p className="text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-2">Brand Icon</p>
                <div
                  onClick={() => fileRef.current?.click()}
                  className="w-20 h-20 rounded-2xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-500 flex items-center justify-center cursor-pointer transition-colors overflow-hidden bg-gray-50 dark:bg-gray-800"
                >
                  {iconPreview ? (
                    <img src={iconPreview} alt="Icon" className="w-full h-full object-cover" />
                  ) : (
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleIconSelect(e.target.files)}
                />
              </div>

              {/* Fields */}
              <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Brand Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    name="brand_name"
                    type="text"
                    required
                    placeholder="e.g. Nike India"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Instagram Username <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-sm">@</span>
                    <input
                      name="instagram_username"
                      type="text"
                      required
                      placeholder="nikeindia"
                      className="w-full pl-8 pr-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Category
                  </label>
                  <select
                    name="category"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all appearance-none"
                  >
                    <option value="">Select category</option>
                    {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Instagram Verified
                  </label>
                  <div className="flex items-center gap-4 h-[42px]">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="instagram_verified" value="yes" className="text-indigo-600 focus:ring-indigo-500" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">Yes</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" name="instagram_verified" value="no" defaultChecked className="text-indigo-600 focus:ring-indigo-500" />
                      <span className="text-sm text-gray-700 dark:text-gray-300">No</span>
                    </label>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Notes <span className="text-gray-400 font-normal">(optional)</span>
                  </label>
                  <input
                    name="notes"
                    type="text"
                    placeholder="e.g. Partnership contact: john@nike.com"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* Info box */}
            <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30">
              <svg className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-[12px] text-blue-700 dark:text-blue-300 leading-relaxed">
                <p className="font-semibold mb-1">How this works:</p>
                <ol className="list-decimal ml-4 space-y-0.5 text-blue-600 dark:text-blue-400">
                  <li>You create an invitation with the brand&apos;s Instagram handle</li>
                  <li>Brand opens RecentGossips app and connects their Instagram</li>
                  <li>If the handle matches, they see a &quot;Complete your profile&quot; screen</li>
                  <li>Brand fills in GSTIN, phone, and verifies — account becomes active</li>
                </ol>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors cursor-pointer"
              >
                {loading && <ButtonSpinner />}
                {loading ? "Creating..." : "Create Invitation"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setError("");
                  setIconFile(null);
                  setIconPreview(null);
                }}
                className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
