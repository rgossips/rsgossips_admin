"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createCampaign, uploadCampaignImage } from "../actions";
import { FullPageLoader } from "@/components/spinner";

import { CATEGORIES } from "@/lib/categories";

async function uploadImage(file: File, folder: string): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);
  const result = await uploadCampaignImage(fd);
  if (result.error) {
    console.error("Upload error:", result.error);
    return null;
  }
  return result.url ?? null;
}

interface Brand {
  id: string;
  name: string | null;
  type: "registered" | "invited";
}

interface ImagePreview {
  file: File;
  url: string;
}

export function CreateCampaignForm({ brands }: { brands: Brand[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Creating campaign...");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [bannerImage, setBannerImage] = useState<ImagePreview | null>(null);
  const [galleryImages, setGalleryImages] = useState<ImagePreview[]>([]);
  const [bannerDragOver, setBannerDragOver] = useState(false);
  const [galleryDragOver, setGalleryDragOver] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const handleBannerSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) return;
    if (bannerImage) URL.revokeObjectURL(bannerImage.url);
    setBannerImage({ file, url: URL.createObjectURL(file) });
  };

  const removeBanner = () => {
    if (bannerImage) URL.revokeObjectURL(bannerImage.url);
    setBannerImage(null);
    if (bannerInputRef.current) bannerInputRef.current.value = "";
  };

  const handleGallerySelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newImages: ImagePreview[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("image/")) {
        newImages.push({ file, url: URL.createObjectURL(file) });
      }
    }
    setGalleryImages((prev) => [...prev, ...newImages]);
  };

  const removeGalleryImage = (index: number) => {
    setGalleryImages((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent, type: "banner" | "gallery") => {
    e.preventDefault();
    if (type === "banner") {
      setBannerDragOver(false);
      handleBannerSelect(e.dataTransfer.files);
    } else {
      setGalleryDragOver(false);
      handleGallerySelect(e.dataTransfer.files);
    }
  }, [bannerImage]);

  const toggleCategory = (cat: string) => {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = async (formData: FormData) => {
    setError("");
    setLoading(true);

    try {
      // Append categories
      selectedCategories.forEach((cat) => formData.append("category", cat));

      // Upload images one-by-one via server action, then pass URLs
      if (bannerImage) {
        setLoadingMsg("Uploading banner image...");
        const bannerUrl = await uploadImage(bannerImage.file, "banners");
        if (bannerUrl) formData.append("banner_image_url", bannerUrl);
      }

      if (galleryImages.length > 0) {
        for (let i = 0; i < galleryImages.length; i++) {
          setLoadingMsg(`Uploading gallery image ${i + 1} of ${galleryImages.length}...`);
          const url = await uploadImage(galleryImages[i].file, "gallery");
          if (url) formData.append("gallery_image_urls", url);
        }
      }

      setLoadingMsg("Saving campaign...");
      const result = await createCampaign(formData);
      if (result.error) {
        setError(result.error);
        setLoading(false);
      } else {
        router.push("/dashboard/campaigns");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <form action={handleSubmit} className="space-y-6">
      {loading && <FullPageLoader message={loadingMsg} />}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <svg className="w-5 h-5 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column — main info */}
        <div className="lg:col-span-2 space-y-6">
          {/* Basic Info Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Basic Information</h2>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">Campaign title, description, and brand</p>
                </div>
              </div>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Campaign Title <span className="text-red-400">*</span>
                </label>
                <input
                  name="title"
                  type="text"
                  required
                  placeholder="e.g. Summer Fashion Collection 2026"
                  className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  Description
                </label>
                <textarea
                  name="description"
                  rows={4}
                  placeholder="Describe the campaign goals, expectations, and any special instructions for influencers..."
                  className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all resize-none"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Brand <span className="text-red-400">*</span>
                  </label>
                  <select
                    name="brand_id"
                    required
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all appearance-none"
                  >
                    <option value="">Select a brand</option>
                    {brands.map((b) => (
                      <option key={b.id} value={`${b.type}:${b.id}`}>
                        {b.name || b.id}{b.type === "invited" ? " (Invited)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Campaign Type <span className="text-red-400">*</span>
                  </label>
                  <select
                    name="campaign_type"
                    required
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all appearance-none"
                  >
                    <option value="barter">Barter</option>
                    <option value="paid">Paid</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Total Slots
                  </label>
                  <input
                    name="max_influencers"
                    type="number"
                    min="1"
                    placeholder="e.g. 10"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Total Budget
                  </label>
                  <input
                    name="budget_total"
                    type="number"
                    min="0"
                    placeholder="e.g. 50000"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                    Budget Per Influencer
                  </label>
                  <input
                    name="budget_per_influencer"
                    type="number"
                    min="0"
                    placeholder="e.g. 5000"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Banner Image Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-violet-600 dark:text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Banner Image</h2>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">Main campaign cover image</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              {bannerImage ? (
                <div className="relative group rounded-xl overflow-hidden">
                  <img
                    src={bannerImage.url}
                    alt="Banner preview"
                    className="w-full h-48 object-cover"
                  />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                    <button
                      type="button"
                      onClick={removeBanner}
                      className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-full bg-white/90 text-red-600 hover:bg-white cursor-pointer shadow-lg"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                  <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-lg bg-black/60 backdrop-blur-sm">
                    <p className="text-[11px] text-white font-medium truncate max-w-[200px]">{bannerImage.file.name}</p>
                  </div>
                </div>
              ) : (
                <div
                  onDragOver={(e) => { e.preventDefault(); setBannerDragOver(true); }}
                  onDragLeave={() => setBannerDragOver(false)}
                  onDrop={(e) => handleDrop(e, "banner")}
                  onClick={() => bannerInputRef.current?.click()}
                  className={`flex flex-col items-center justify-center h-48 rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer ${
                    bannerDragOver
                      ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-900/10"
                      : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-3 ${
                    bannerDragOver ? "bg-indigo-100 dark:bg-indigo-900/30" : "bg-gray-100 dark:bg-gray-700"
                  }`}>
                    <svg className={`w-6 h-6 ${bannerDragOver ? "text-indigo-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                    {bannerDragOver ? "Drop image here" : "Click or drag to upload"}
                  </p>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">PNG, JPG, WebP up to 5MB</p>
                </div>
              )}
              <input
                ref={bannerInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleBannerSelect(e.target.files)}
              />
            </div>
          </div>

          {/* Gallery Images Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center">
                    <svg className="w-4 h-4 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Gallery Images</h2>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500">Upload multiple reference or product images</p>
                  </div>
                </div>
                {galleryImages.length > 0 && (
                  <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded-full">
                    {galleryImages.length} image{galleryImages.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            <div className="p-6">
              {/* Gallery grid */}
              {galleryImages.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
                  {galleryImages.map((img, i) => (
                    <div key={i} className="relative group aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
                      <img src={img.url} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                        <button
                          type="button"
                          onClick={() => removeGalleryImage(i)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-full bg-white/90 text-red-600 hover:bg-white cursor-pointer shadow-lg"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                      <div className="absolute bottom-1.5 left-1.5 w-5 h-5 rounded-md bg-black/60 flex items-center justify-center">
                        <span className="text-[9px] font-bold text-white">{i + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Upload zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setGalleryDragOver(true); }}
                onDragLeave={() => setGalleryDragOver(false)}
                onDrop={(e) => handleDrop(e, "gallery")}
                onClick={() => galleryInputRef.current?.click()}
                className={`flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer ${
                  galleryDragOver
                    ? "border-teal-400 bg-teal-50 dark:bg-teal-900/10"
                    : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`}
              >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                  galleryDragOver ? "bg-teal-100 dark:bg-teal-900/30" : "bg-gray-100 dark:bg-gray-700"
                }`}>
                  <svg className={`w-5 h-5 ${galleryDragOver ? "text-teal-500" : "text-gray-400"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  {galleryDragOver ? "Drop images here" : galleryImages.length > 0 ? "Add more images" : "Click or drag to upload images"}
                </p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">Select multiple files at once</p>
              </div>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => handleGallerySelect(e.target.files)}
              />
            </div>
          </div>

          {/* Content Deliverables Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-pink-50 dark:bg-pink-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-pink-600 dark:text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Content Deliverables</h2>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">What influencers need to create</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { name: "num_reels", label: "Reels", icon: "M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z", color: "text-rose-500" },
                  { name: "num_posts", label: "Posts", icon: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z", color: "text-blue-500" },
                  { name: "num_stories", label: "Stories", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z", color: "text-amber-500" },
                  { name: "num_videos", label: "Videos", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z", color: "text-purple-500" },
                ].map((item) => (
                  <div key={item.name} className="relative">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <svg className={`w-3.5 h-3.5 ${item.color}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
                      </svg>
                      <label className="text-[13px] font-medium text-gray-700 dark:text-gray-300">{item.label}</label>
                    </div>
                    <input
                      name={item.name}
                      type="number"
                      min="0"
                      placeholder="0"
                      className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm text-center focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Requirements Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Influencer Requirements</h2>
                  <p className="text-[11px] text-gray-400 dark:text-gray-500">Set minimum criteria for applicants</p>
                </div>
              </div>
            </div>
            <div className="p-6">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Min. Followers</label>
                  <input
                    name="target_follower_min"
                    type="number"
                    min="0"
                    placeholder="e.g. 1000"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Max. Followers</label>
                  <input
                    name="target_follower_max"
                    type="number"
                    min="0"
                    placeholder="e.g. 100000"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Influencer Tier</label>
                  <select
                    name="target_influencer_tier"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all appearance-none"
                  >
                    <option value="all">All Tiers</option>
                    <option value="nano">Nano (1K-10K)</option>
                    <option value="micro">Micro (10K-100K)</option>
                    <option value="macro">Macro (100K-1M)</option>
                    <option value="mega">Mega (1M+)</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Min. Engagement Rate (%)</label>
                  <input
                    name="min_engagement_rate"
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="e.g. 2.5"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Location (comma-separated)</label>
                  <input
                    name="target_cities"
                    type="text"
                    placeholder="e.g. Mumbai, Delhi, Bangalore"
                    className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right column — sidebar */}
        <div className="space-y-6">
          {/* Categories Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Categories</h2>
              </div>
            </div>
            <div className="p-5 space-y-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => toggleCategory(cat)}
                  className={`flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-200 cursor-pointer border ${
                    selectedCategories.includes(cat)
                      ? "bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800"
                      : "bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-transparent hover:border-gray-200 dark:hover:border-gray-700 hover:bg-white dark:hover:bg-gray-750"
                  }`}
                >
                  <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors ${
                    selectedCategories.includes(cat)
                      ? "bg-indigo-600 border-indigo-600"
                      : "border-gray-300 dark:border-gray-600"
                  }`}>
                    {selectedCategories.includes(cat) && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Dates Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-cyan-50 dark:bg-cyan-900/30 flex items-center justify-center">
                  <svg className="w-4 h-4 text-cyan-600 dark:text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Schedule</h2>
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Start Date <span className="text-red-400">*</span></label>
                <input
                  name="campaign_start_date"
                  type="date"
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                />
              </div>
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Deadline <span className="text-red-400">*</span></label>
                <input
                  name="campaign_end_date"
                  type="date"
                  required
                  className="w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all"
                />
                <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">Applications close and the campaign ends on this date.</p>
              </div>
            </div>
          </div>

          {/* Submit Card */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5">
            <div className="space-y-3">
              <button
                type="submit"
                disabled={loading}
                className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-indigo-300 disabled:to-purple-300 disabled:cursor-not-allowed text-white text-sm font-semibold transition-all duration-200 cursor-pointer shadow-lg shadow-indigo-200/50 dark:shadow-indigo-900/30 hover:shadow-xl hover:shadow-indigo-200/60"
              >
                {loading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creating...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    Create Campaign
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard/campaigns")}
                className="w-full px-6 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium transition-all duration-200 cursor-pointer"
              >
                Cancel
              </button>
            </div>
            <p className="text-[11px] text-gray-400 dark:text-gray-600 text-center mt-3">
              Campaign will be created as a draft
            </p>
          </div>
        </div>
      </div>
    </form>
  );
}
