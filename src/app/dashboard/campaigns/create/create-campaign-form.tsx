"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createCampaign, uploadCampaignImage } from "../actions";
import { FullPageLoader } from "@/components/spinner";

import { CATEGORIES } from "@/lib/categories";

const PLATFORMS = ["Instagram", "YouTube", "TikTok", "LinkedIn", "X (Twitter)", "Blog"];
const CITIES = [
  "Mumbai", "Delhi", "Bangalore", "Hyderabad", "Pune", "Chennai",
  "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Indore",
  "Bhopal", "Kochi", "Remote",
];
const LANGUAGES = [
  "Hindi", "English", "Tamil", "Telugu", "Marathi", "Kannada",
  "Bengali", "Gujarati", "Punjabi", "Malayalam",
];
const GENDERS = ["Male", "Female", "Any"];

const TIER_RANGES: Record<string, { min: number; max: number }> = {
  nano: { min: 1000, max: 10000 },
  micro: { min: 10000, max: 100000 },
  macro: { min: 100000, max: 1000000 },
  mega: { min: 1000000, max: 10000000 },
};

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

const DESCRIPTION_TEMPLATE =
  "What is this campaign about?\n\nWhat do you want the influencer to highlight?\n\nAny specific messaging or hashtags?";

export function CreateCampaignForm({ brands }: { brands: Brand[] }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("Creating campaign...");

  const [campaignType, setCampaignType] = useState<"barter" | "paid" | "hybrid">("barter");
  const [budgetTotal, setBudgetTotal] = useState("");
  const [maxInfluencers, setMaxInfluencers] = useState("");
  const [tier, setTier] = useState("all");
  const [followerMin, setFollowerMin] = useState("");
  const [followerMax, setFollowerMax] = useState("");

  const [numReels, setNumReels] = useState("");
  const [numPosts, setNumPosts] = useState("");
  const [numStories, setNumStories] = useState("");
  const [numVideos, setNumVideos] = useState("");
  const [numBlogs, setNumBlogs] = useState("");

  const [shippingRequired, setShippingRequired] = useState<"no" | "yes" | "pickup">("no");
  const [offeringType, setOfferingType] = useState<"product" | "service">("product");

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [allIndia, setAllIndia] = useState(false);
  const [selectedGenders, setSelectedGenders] = useState<string[]>([]);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>([]);

  const [bannerImage, setBannerImage] = useState<ImagePreview | null>(null);
  const [galleryImages, setGalleryImages] = useState<ImagePreview[]>([]);
  const [bannerDragOver, setBannerDragOver] = useState(false);
  const [galleryDragOver, setGalleryDragOver] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const isBarter = campaignType === "barter";
  const isHybrid = campaignType === "hybrid";

  // Auto-fill follower min/max when tier changes
  useEffect(() => {
    const range = TIER_RANGES[tier];
    if (range) {
      setFollowerMin(String(range.min));
      setFollowerMax(String(range.max));
    }
  }, [tier]);

  // Auto-calc Budget / Influencer
  const budgetPerInfluencer = useMemo(() => {
    const total = Number(budgetTotal) || 0;
    const slots = Number(maxInfluencers) || 0;
    if (total > 0 && slots > 0) return Math.round(total / slots);
    return 0;
  }, [budgetTotal, maxInfluencers]);

  const totalDeliverables = useMemo(() => {
    return [numReels, numPosts, numStories, numVideos, numBlogs]
      .reduce((s, v) => s + (Number(v) || 0), 0);
  }, [numReels, numPosts, numStories, numVideos, numBlogs]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<string[]>>) => (val: string) => {
    setter((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]));
  };

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

  const handleSubmit = async (formData: FormData) => {
    setError("");

    if (totalDeliverables < 1) {
      setError("Add at least 1 deliverable");
      return;
    }
    if (selectedCategories.length < 1) {
      setError("Select at least 1 category");
      return;
    }
    if (selectedPlatforms.length < 1) {
      setError("Select at least 1 platform");
      return;
    }

    setLoading(true);
    try {
      // Categories
      selectedCategories.forEach((cat) => formData.append("category", cat));

      // Cities
      const finalCities = allIndia ? ["All India"] : selectedCities;
      formData.set("target_cities", finalCities.join(","));

      // Auto-calc'd budget per influencer (overwrite manual)
      formData.set("budget_per_influencer", String(budgetPerInfluencer));

      // Extras (packed into description metadata server-side)
      formData.append("platforms_json", JSON.stringify(selectedPlatforms));
      formData.append("genders_json", JSON.stringify(selectedGenders));
      formData.append("languages_json", JSON.stringify(selectedLanguages));
      formData.append("offering_type", offeringType);

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

  const inputClass =
    "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all";
  const labelClass = "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5";

  const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );

  const Chip = ({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full text-[12px] font-medium border transition-colors cursor-pointer ${
        on
          ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
          : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
      }`}
    >
      {on ? "✓ " : ""}{label}
    </button>
  );

  return (
    <form action={handleSubmit} className="space-y-6">
      {loading && <FullPageLoader message={loadingMsg} />}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <Card title="Basic information">
            <div>
              <label className={labelClass}>Campaign Title <span className="text-red-400">*</span></label>
              <input name="title" type="text" required placeholder="e.g. Summer Fashion 2026" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea name="description" rows={5} placeholder={DESCRIPTION_TEMPLATE} className={`${inputClass} resize-none`} />
              <p className="text-[11px] text-gray-400 mt-1">A guided template helps creators understand what you need.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Brand <span className="text-red-400">*</span></label>
                <select name="brand_id" required className={inputClass}>
                  <option value="">Select a brand</option>
                  {brands.map((b) => (
                    <option key={b.id} value={`${b.type}:${b.id}`}>
                      {b.name || b.id}{b.type === "invited" ? " (Invited)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Campaign Type <span className="text-red-400">*</span></label>
                <select
                  name="campaign_type"
                  value={campaignType}
                  onChange={(e) => setCampaignType(e.target.value as any)}
                  required
                  className={inputClass}
                >
                  <option value="barter">Barter</option>
                  <option value="paid">Paid</option>
                  <option value="hybrid">Hybrid</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Total Slots</label>
                <input
                  name="max_influencers"
                  type="number"
                  min="1"
                  value={maxInfluencers}
                  onChange={(e) => setMaxInfluencers(e.target.value)}
                  placeholder="10"
                  className={inputClass}
                />
              </div>
              {!isBarter && (
                <div>
                  <label className={labelClass}>Total Budget</label>
                  <input
                    name="budget_total"
                    type="number"
                    min="0"
                    value={budgetTotal}
                    onChange={(e) => setBudgetTotal(e.target.value)}
                    placeholder="50000"
                    className={inputClass}
                  />
                </div>
              )}
              {!isBarter && (
                <div>
                  <label className={labelClass}>Budget / Influencer</label>
                  <input
                    name="budget_per_influencer"
                    type="number"
                    value={budgetPerInfluencer || ""}
                    readOnly
                    placeholder="—"
                    className={`${inputClass} bg-gray-100 dark:bg-gray-700 cursor-not-allowed`}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Auto-calculated from total ÷ slots</p>
                </div>
              )}
              {(isBarter || isHybrid) && (
                <div>
                  <label className={labelClass}>Product value (approx.)</label>
                  <input
                    name="product_value"
                    type="number"
                    min="0"
                    placeholder="3500"
                    className={inputClass}
                  />
                </div>
              )}
            </div>
          </Card>

          <Card title="Product / service">
            <div>
              <label className={labelClass}>What are you promoting? <span className="text-red-400">*</span></label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <button
                  type="button"
                  onClick={() => setOfferingType("product")}
                  className={`py-2 rounded-xl text-sm font-semibold border transition-colors cursor-pointer ${
                    offeringType === "product"
                      ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
                      : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600"
                  }`}
                >
                  📦 Product
                </button>
                <button
                  type="button"
                  onClick={() => setOfferingType("service")}
                  className={`py-2 rounded-xl text-sm font-semibold border transition-colors cursor-pointer ${
                    offeringType === "service"
                      ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
                      : "bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600"
                  }`}
                >
                  🛎️ Service / Experience
                </button>
              </div>
              <input
                name="product_name"
                type="text"
                placeholder={offeringType === "product"
                  ? 'e.g. "Moisturizing cream — 50ml tube"'
                  : 'e.g. "Weekend stay at our Mussoorie resort"'}
                className={inputClass}
              />
            </div>

            {offeringType === "product" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>Will product be shipped?</label>
                  <select
                    name="shipping_required"
                    value={shippingRequired}
                    onChange={(e) => setShippingRequired(e.target.value as any)}
                    className={inputClass}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                    <option value="pickup">Pickup required</option>
                  </select>
                </div>
                {shippingRequired === "yes" && (
                  <div>
                    <label className={labelClass}>Shipping timeline (days)</label>
                    <input
                      name="shipping_timeline_days"
                      type="number"
                      min="1"
                      placeholder="3"
                      className={inputClass}
                    />
                  </div>
                )}
              </div>
            )}

            {offeringType === "service" && (
              <div>
                <label className={labelClass}>Service location</label>
                <input
                  name="service_location"
                  type="text"
                  placeholder='e.g. "Mussoorie, India" or "Online / virtual"'
                  className={inputClass}
                />
                <p className="text-[11px] text-gray-400 mt-1">Where the influencer experiences the service.</p>
              </div>
            )}

            {(isBarter || isHybrid) && (
              <div>
                <label className={labelClass}>What does the influencer get? (compensation)</label>
                <textarea
                  name="barter_compensation"
                  rows={2}
                  placeholder={offeringType === "product"
                    ? 'e.g. "Full skincare kit worth ₹3,500"'
                    : 'e.g. "Free 2-night stay + meals + spa session"'}
                  className={`${inputClass} resize-none`}
                />
              </div>
            )}
          </Card>

          <Card title="Banner image">
            {bannerImage ? (
              <div className="relative group rounded-xl overflow-hidden">
                <img src={bannerImage.url} alt="Banner preview" className="w-full h-48 object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <button
                    type="button"
                    onClick={removeBanner}
                    className="opacity-0 group-hover:opacity-100 transition-opacity px-4 py-2 rounded-xl bg-white/90 text-red-600 font-medium text-sm cursor-pointer shadow-lg"
                  >
                    Remove
                  </button>
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
                    : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-300"
                }`}
              >
                <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Click or drag to upload</p>
                <p className="text-[11px] text-gray-400 mt-1">PNG, JPG, WebP up to 10MB</p>
              </div>
            )}
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleBannerSelect(e.target.files)}
            />
          </Card>

          <Card title="Gallery">
            {galleryImages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {galleryImages.map((img, i) => (
                  <div key={i} className="relative group aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
                    <img src={img.url} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeGalleryImage(i)}
                      className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-white/90 text-red-600 cursor-pointer shadow"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div
              onDragOver={(e) => { e.preventDefault(); setGalleryDragOver(true); }}
              onDragLeave={() => setGalleryDragOver(false)}
              onDrop={(e) => handleDrop(e, "gallery")}
              onClick={() => galleryInputRef.current?.click()}
              className={`flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed transition-all duration-200 cursor-pointer ${
                galleryDragOver
                  ? "border-teal-400 bg-teal-50 dark:bg-teal-900/10"
                  : "border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-gray-300"
              }`}
            >
              <p className="text-sm font-medium text-gray-600 dark:text-gray-400">
                {galleryImages.length > 0 ? "Add more images" : "Click or drag to upload images"}
              </p>
            </div>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => handleGallerySelect(e.target.files)}
            />
          </Card>

          <Card title={`Content deliverables · ${totalDeliverables} piece${totalDeliverables !== 1 ? "s" : ""}`}>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div>
                <label className={labelClass}>Reels</label>
                <input name="num_reels" type="number" min="0" value={numReels} onChange={(e) => setNumReels(e.target.value)} placeholder="0" className={`${inputClass} text-center`} />
              </div>
              <div>
                <label className={labelClass}>Posts</label>
                <input name="num_posts" type="number" min="0" value={numPosts} onChange={(e) => setNumPosts(e.target.value)} placeholder="0" className={`${inputClass} text-center`} />
              </div>
              <div>
                <label className={labelClass}>Stories</label>
                <input name="num_stories" type="number" min="0" value={numStories} onChange={(e) => setNumStories(e.target.value)} placeholder="0" className={`${inputClass} text-center`} />
              </div>
              <div>
                <label className={labelClass}>Videos</label>
                <input name="num_videos" type="number" min="0" value={numVideos} onChange={(e) => setNumVideos(e.target.value)} placeholder="0" className={`${inputClass} text-center`} />
              </div>
              <div>
                <label className={labelClass}>Blogs</label>
                <input name="num_blogs" type="number" min="0" value={numBlogs} onChange={(e) => setNumBlogs(e.target.value)} placeholder="0" className={`${inputClass} text-center`} />
              </div>
            </div>
            {totalDeliverables === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400">At least 1 deliverable is required.</p>
            )}
          </Card>

          <Card title="Influencer requirements">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className={labelClass}>Influencer Tier</label>
                <select
                  name="target_influencer_tier"
                  value={tier}
                  onChange={(e) => setTier(e.target.value)}
                  className={inputClass}
                >
                  <option value="all">All Tiers</option>
                  <option value="nano">Nano (1K-10K)</option>
                  <option value="micro">Micro (10K-100K)</option>
                  <option value="macro">Macro (100K-1M)</option>
                  <option value="mega">Mega (1M+)</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Min. Followers</label>
                <input
                  name="target_follower_min"
                  type="number"
                  min="0"
                  value={followerMin}
                  onChange={(e) => setFollowerMin(e.target.value)}
                  placeholder="1000"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Max. Followers</label>
                <input
                  name="target_follower_max"
                  type="number"
                  min="0"
                  value={followerMax}
                  onChange={(e) => setFollowerMax(e.target.value)}
                  placeholder="100000"
                  className={inputClass}
                />
              </div>
            </div>
            <div>
              <label className={labelClass}>Min. Engagement Rate (%)</label>
              <input name="min_engagement_rate" type="number" min="0" step="0.1" placeholder="2.5" className={inputClass} />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className={labelClass} style={{ marginBottom: 0 }}>Locations</label>
                <label className="flex items-center gap-2 text-[11px] font-medium text-gray-600 dark:text-gray-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allIndia}
                    onChange={(e) => setAllIndia(e.target.checked)}
                    className="w-4 h-4 accent-indigo-500"
                  />
                  All India
                </label>
              </div>
              {!allIndia && (
                <div className="flex flex-wrap gap-2">
                  {CITIES.map((c) => (
                    <Chip key={c} label={c} on={selectedCities.includes(c)} onClick={() => toggle(setSelectedCities)(c)} />
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className={labelClass}>Preferred gender</label>
              <div className="flex flex-wrap gap-2">
                {GENDERS.map((g) => (
                  <Chip key={g} label={g} on={selectedGenders.includes(g)} onClick={() => toggle(setSelectedGenders)(g)} />
                ))}
              </div>
            </div>
            <div>
              <label className={labelClass}>Preferred languages</label>
              <div className="flex flex-wrap gap-2">
                {LANGUAGES.map((l) => (
                  <Chip key={l} label={l} on={selectedLanguages.includes(l)} onClick={() => toggle(setSelectedLanguages)(l)} />
                ))}
              </div>
            </div>
          </Card>

          <Card title="Content guidelines">
            <div>
              <label className={labelClass}>Must include (Do&apos;s)</label>
              <textarea name="content_dos" rows={2} placeholder='"Show product packaging, mention discount code SAVE20"' className={`${inputClass} resize-none`} />
            </div>
            <div>
              <label className={labelClass}>Must avoid (Don&apos;ts)</label>
              <textarea name="content_donts" rows={2} placeholder='"No competitor products, no copyrighted music"' className={`${inputClass} resize-none`} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Required hashtags</label>
                <input name="required_hashtags" type="text" placeholder="#RGossips #Ad #Paidpartnership" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Brand handle(s) to tag</label>
                <input name="brand_handles_to_tag" type="text" placeholder="@yourbrand" className={inputClass} />
              </div>
            </div>
          </Card>

          <Card title="Terms & rights">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Content usage rights</label>
                <select name="usage_rights" defaultValue="creator_only" className={inputClass}>
                  <option value="creator_only">Influencer&apos;s page only</option>
                  <option value="brand_repost">Brand can repost</option>
                  <option value="paid_ads">Brand can use in paid ads</option>
                  <option value="full_rights">Full rights transfer</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Content keep-up duration</label>
                <select name="keepup_duration" defaultValue="permanent" className={inputClass}>
                  <option value="24h">24 hours (stories)</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Exclusivity (no competing brands)</label>
                <select name="exclusivity_days" defaultValue="0" className={inputClass}>
                  <option value="0">No exclusivity</option>
                  <option value="7">7 days</option>
                  <option value="15">15 days</option>
                  <option value="30">30 days</option>
                  <option value="60">60 days</option>
                  <option value="90">90 days</option>
                </select>
              </div>
              {!isBarter && (
                <div>
                  <label className={labelClass}>Payment timeline</label>
                  <select name="payment_timeline" defaultValue="on_approval" className={inputClass}>
                    <option value="advance">Advance</option>
                    <option value="on_approval">On content approval</option>
                    <option value="7_days">Within 7 days of posting</option>
                    <option value="30_days">Within 30 days</option>
                  </select>
                </div>
              )}
            </div>
          </Card>
        </div>

        {/* Right column — sidebar */}
        <div className="space-y-6">
          <Card title="Platforms *">
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map((p) => (
                <Chip key={p} label={p} on={selectedPlatforms.includes(p)} onClick={() => toggle(setSelectedPlatforms)(p)} />
              ))}
            </div>
            {selectedPlatforms.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">Select at least 1 platform.</p>
            )}
          </Card>

          <Card title={`Categories · ${selectedCategories.length} of ${CATEGORIES.length}`}>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((cat) => (
                <Chip key={cat} label={cat} on={selectedCategories.includes(cat)} onClick={() => toggle(setSelectedCategories)(cat)} />
              ))}
            </div>
            {selectedCategories.length === 0 && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">Select at least 1 category.</p>
            )}
          </Card>

          <Card title="Schedule">
            <div>
              <label className={labelClass}>Start Date <span className="text-red-400">*</span></label>
              <input name="campaign_start_date" type="date" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Application Deadline <span className="text-red-400">*</span></label>
              <input name="application_deadline" type="date" required className={inputClass} />
              <p className="text-[11px] text-gray-400 mt-1">Last day for influencers to apply.</p>
            </div>
            <div>
              <label className={labelClass}>Campaign End Date <span className="text-red-400">*</span></label>
              <input name="campaign_end_date" type="date" required className={inputClass} />
              <p className="text-[11px] text-gray-400 mt-1">All content must be delivered by this date.</p>
            </div>
          </Card>

          <Card title="Submit">
            <button
              type="submit"
              disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:opacity-50 text-white text-sm font-semibold cursor-pointer shadow-lg"
            >
              {loading ? "Creating..." : "Create Campaign"}
            </button>
            <button
              type="button"
              onClick={() => router.push("/dashboard/campaigns")}
              className="w-full px-6 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 text-gray-600 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            <p className="text-[11px] text-gray-400 text-center">Campaign will be created as a draft</p>
          </Card>
        </div>
      </div>
    </form>
  );
}
