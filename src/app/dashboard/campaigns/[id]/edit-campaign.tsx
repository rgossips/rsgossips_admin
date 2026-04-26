"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { updateCampaign, uploadCampaignImage } from "../actions";
import { ButtonSpinner, FullPageLoader } from "@/components/spinner";
import { CATEGORIES } from "@/lib/categories";

const inputClass = "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";
const labelClass = "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5";

export function EditCampaignButton({ campaign, description, bannerUrl, galleryUrls, engagementRate, deliverables }: {
  campaign: any;
  description: string;
  bannerUrl: string | null;
  galleryUrls: string[];
  engagementRate: number | null;
  deliverables: Record<string, number>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 text-sm font-medium transition-colors cursor-pointer">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
        Edit
      </button>
      {open && <EditCampaignModal campaign={campaign} description={description} bannerUrl={bannerUrl} galleryUrls={galleryUrls} engagementRate={engagementRate} deliverables={deliverables} onClose={() => setOpen(false)} />}
    </>
  );
}

async function uploadImage(file: File, folder: string): Promise<string | null> {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("folder", folder);
  const result = await uploadCampaignImage(fd);
  return result.error ? null : result.url ?? null;
}

function EditCampaignModal({ campaign, description, bannerUrl, galleryUrls, engagementRate, deliverables, onClose }: {
  campaign: any; description: string; bannerUrl: string | null; galleryUrls: string[]; engagementRate: number | null; deliverables: Record<string, number>; onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");

  // Banner
  const [bannerPreview, setBannerPreview] = useState(bannerUrl || "");
  const [bannerFile, setBannerFile] = useState<File | null>(null);
  const bannerRef = useRef<HTMLInputElement>(null);

  // Gallery
  const [existingGallery, setExistingGallery] = useState<string[]>(galleryUrls);
  const [newGalleryFiles, setNewGalleryFiles] = useState<{ file: File; url: string }[]>([]);
  const galleryRef = useRef<HTMLInputElement>(null);

  // Categories
  const [selectedCategories, setSelectedCategories] = useState<string[]>(campaign.target_categories || []);

  const handleBannerSelect = (files: FileList | null) => {
    if (!files?.[0]?.type.startsWith("image/")) return;
    setBannerFile(files[0]);
    setBannerPreview(URL.createObjectURL(files[0]));
  };

  const handleGalleryAdd = (files: FileList | null) => {
    if (!files) return;
    const items: { file: File; url: string }[] = [];
    for (let i = 0; i < files.length; i++) {
      if (files[i].type.startsWith("image/")) items.push({ file: files[i], url: URL.createObjectURL(files[i]) });
    }
    setNewGalleryFiles((prev) => [...prev, ...items]);
  };

  const handleSubmit = async (formData: FormData) => {
    setError(""); setLoading(true);
    try {
      // Append categories
      selectedCategories.forEach((c) => formData.append("category", c));

      // Upload banner if changed
      if (bannerFile) {
        setLoadingMsg("Uploading banner...");
        const url = await uploadImage(bannerFile, "banners");
        if (url) formData.append("banner_image_url", url);
      } else if (bannerPreview) {
        formData.append("banner_image_url", bannerPreview);
      }

      // Upload new gallery images
      for (let i = 0; i < newGalleryFiles.length; i++) {
        setLoadingMsg(`Uploading gallery ${i + 1}/${newGalleryFiles.length}...`);
        const url = await uploadImage(newGalleryFiles[i].file, "gallery");
        if (url) formData.append("gallery_image_urls", url);
      }

      // Pass existing gallery URLs
      formData.append("existing_gallery", existingGallery.join(","));

      setLoadingMsg("Saving campaign...");
      const result = await updateCampaign(campaign.campaign_id, formData);
      if (result.error) { setError(result.error); setLoading(false); }
      else { router.refresh(); onClose(); }
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); setLoading(false); }
  };

  // Categories from shared constant

  return (
    <>
      {loading && <FullPageLoader message={loadingMsg} />}
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed z-50 inset-2 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-3xl lg:max-h-[90vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-800 shrink-0">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">Edit Campaign</h2>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <form action={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5">
          {error && <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 text-sm">{error}</div>}

          {/* Basic */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelClass}>Title</label>
              <input name="title" defaultValue={campaign.title || ""} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Description</label>
              <textarea name="description" rows={3} defaultValue={description} className={`${inputClass} resize-none`} />
            </div>
            <div>
              <label className={labelClass}>Campaign Type</label>
              <select name="campaign_type" defaultValue={campaign.campaign_type || "barter"} className={inputClass}>
                <option value="barter">Barter</option><option value="paid">Paid</option><option value="hybrid">Hybrid</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select name="status" defaultValue={campaign.status || "draft"} className={inputClass}>
                <option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="completed">Completed</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Total Slots</label>
              <input name="max_influencers" type="number" defaultValue={campaign.max_influencers || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Total Budget</label>
              <input name="budget_total" type="number" defaultValue={campaign.budget_total || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Budget Per Influencer</label>
              <input name="budget_per_influencer" type="number" defaultValue={campaign.budget_per_influencer || ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Influencer Tier</label>
              <select name="target_influencer_tier" defaultValue={campaign.target_influencer_tier || "all"} className={inputClass}>
                <option value="all">All</option><option value="nano">Nano</option><option value="micro">Micro</option><option value="macro">Macro</option><option value="mega">Mega</option>
              </select>
            </div>
          </div>

          {/* Dates — single deadline (applications close + campaign ends) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={labelClass}>Start Date</label><input name="campaign_start_date" type="date" defaultValue={campaign.campaign_start_date?.split("T")[0] || ""} className={inputClass} /></div>
            <div><label className={labelClass}>Deadline</label><input name="campaign_end_date" type="date" defaultValue={(campaign.campaign_end_date || campaign.application_deadline)?.split("T")[0] || ""} className={inputClass} /></div>
          </div>

          {/* Deliverables */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div><label className={labelClass}>Reels</label><input name="num_reels" type="number" min="0" defaultValue={deliverables.reels || 0} className={inputClass} /></div>
            <div><label className={labelClass}>Posts</label><input name="num_posts" type="number" min="0" defaultValue={deliverables.posts || 0} className={inputClass} /></div>
            <div><label className={labelClass}>Stories</label><input name="num_stories" type="number" min="0" defaultValue={deliverables.stories || 0} className={inputClass} /></div>
            <div><label className={labelClass}>Videos</label><input name="num_videos" type="number" min="0" defaultValue={deliverables.videos || 0} className={inputClass} /></div>
          </div>

          {/* Requirements */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div><label className={labelClass}>Min Followers</label><input name="target_follower_min" type="number" defaultValue={campaign.target_follower_min || 0} className={inputClass} /></div>
            <div><label className={labelClass}>Max Followers</label><input name="target_follower_max" type="number" defaultValue={campaign.target_follower_max || 1000000} className={inputClass} /></div>
            <div><label className={labelClass}>Min Engagement %</label><input name="min_engagement_rate" type="number" step="0.1" defaultValue={engagementRate || ""} className={inputClass} /></div>
          </div>
          <div><label className={labelClass}>Target Cities (comma-separated)</label><input name="target_cities" defaultValue={campaign.target_cities?.join(", ") || ""} className={inputClass} /></div>

          {/* Categories */}
          <div>
            <label className={labelClass}>Categories</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button key={cat} type="button" onClick={() => setSelectedCategories((p) => p.includes(cat) ? p.filter((c) => c !== cat) : [...p, cat])}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer transition-all border ${selectedCategories.includes(cat) ? "bg-indigo-600 text-white border-indigo-600" : "bg-gray-50 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:border-indigo-400"}`}
                >{cat}</button>
              ))}
            </div>
          </div>

          {/* Banner Image */}
          <div>
            <label className={labelClass}>Banner Image</label>
            <div className="flex items-center gap-4">
              <div onClick={() => bannerRef.current?.click()} className="w-32 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 flex items-center justify-center cursor-pointer overflow-hidden bg-gray-50 dark:bg-gray-800 shrink-0">
                {bannerPreview ? <img src={bannerPreview} alt="" className="w-full h-full object-cover" /> : (
                  <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                )}
              </div>
              <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleBannerSelect(e.target.files)} />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Click to change banner</p>
                {bannerPreview && <button type="button" onClick={() => { setBannerPreview(""); setBannerFile(null); }} className="text-xs text-red-500 mt-1 cursor-pointer">Remove</button>}
              </div>
            </div>
          </div>

          {/* Gallery */}
          <div>
            <label className={labelClass}>Gallery Images</label>
            <div className="flex flex-wrap gap-2">
              {existingGallery.map((url, i) => (
                <div key={url} className="relative w-20 h-20 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 group">
                  <img src={url} alt="" className="w-full h-full object-cover" />
                  <button type="button" onClick={() => setExistingGallery((p) => p.filter((_, j) => j !== i))} className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                  </button>
                </div>
              ))}
              {newGalleryFiles.map((item, i) => (
                <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-indigo-300 group">
                  <img src={item.url} alt="" className="w-full h-full object-cover" />
                  <span className="absolute top-1 left-1 text-[8px] px-1 py-0.5 bg-indigo-600 text-white rounded font-bold">NEW</span>
                  <button type="button" onClick={() => setNewGalleryFiles((p) => p.filter((_, j) => j !== i))} className="absolute inset-0 bg-black/0 group-hover:bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
              ))}
              <div onClick={() => galleryRef.current?.click()} className="w-20 h-20 rounded-xl border-2 border-dashed border-gray-300 dark:border-gray-600 hover:border-indigo-400 flex items-center justify-center cursor-pointer bg-gray-50 dark:bg-gray-800">
                <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              </div>
              <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleGalleryAdd(e.target.files)} />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-semibold cursor-pointer">
              {loading && <ButtonSpinner />}{loading ? "Saving..." : "Save Changes"}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
