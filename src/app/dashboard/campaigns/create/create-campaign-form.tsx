"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createCampaign, updateCampaign, uploadCampaignImage } from "../actions";
import { FullPageLoader } from "@/components/spinner";

import { CATEGORIES } from "@/lib/categories";

// Shape passed in when the form is in edit mode. Optional fields mirror
// the columns we read off `campaigns` + the metadata we pack into the
// description (see actions.ts).
export interface CampaignInitial {
  campaign_id: string;
  title: string;
  description: string; // cleaned (metadata trailer stripped by the caller)
  brand_id: string | null;
  brand_invitation_id: string | null;
  status: string;
  campaign_type: "barter" | "paid" | "hybrid";
  max_influencers: number | null;
  budget_total: number | null;
  target_follower_min: number | null;
  target_follower_max: number | null;
  target_influencer_tier: string | null;
  target_categories: string[] | null;
  target_cities: string[] | null;
  campaign_start_date: string | null;
  campaign_end_date: string | null;
  application_deadline: string | null;
  deliverables: Record<string, number>;
  banner_image: string | null;
  gallery_images: string[];
  min_engagement_rate: number | null;
  platforms: string[];
  target_gender: string[];
  target_languages: string[];
  offering_type: "product" | "service" | null;
  product_name: string;
  product_value: number | null;
  shipping_required: string;
  shipping_timeline_days: number | null;
  service_location: string;
  barter_compensation: string;
  content_dos: string;
  content_donts: string;
  required_hashtags: string;
  brand_handles_to_tag: string;
  usage_rights: string;
  keepup_duration: string;
  exclusivity_days: string;
  payment_timeline: string;
}

const PLATFORMS = ["Instagram"];
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

// Defined outside CreateCampaignForm so React doesn't see a new component
// identity on every render. When these lived inside the form, any state
// change (typing in a deliverable count) remounted every input under
// the card, kicking focus out and looking like the form was "resetting".
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h2>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function Chip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
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
}

export function CreateCampaignForm({ brands, initial }: { brands: Brand[]; initial?: CampaignInitial }) {
  const router = useRouter();
  const isEdit = !!initial;
  // The "brand_id" select expects format "registered:uuid" or "invited:uuid".
  // Build that prefilled value when we're editing an existing row.
  const initialBrandValue = initial?.brand_id
    ? `registered:${initial.brand_id}`
    : initial?.brand_invitation_id
      ? `invited:${initial.brand_invitation_id}`
      : "";
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(isEdit ? "Saving campaign..." : "Creating campaign...");

  const [campaignType, setCampaignType] = useState<"barter" | "paid" | "hybrid">(initial?.campaign_type || "barter");
  const [status, setStatus] = useState<string>(initial?.status || "draft");
  const [brandSelect, setBrandSelect] = useState<string>(initialBrandValue);
  const [title, setTitle] = useState(initial?.title || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [budgetTotal, setBudgetTotal] = useState(initial?.budget_total ? String(initial.budget_total) : "");
  const [maxInfluencers, setMaxInfluencers] = useState(initial?.max_influencers ? String(initial.max_influencers) : "");
  const [tier, setTier] = useState(initial?.target_influencer_tier || "all");
  const [followerMin, setFollowerMin] = useState(initial?.target_follower_min ? String(initial.target_follower_min) : "");
  const [followerMax, setFollowerMax] = useState(initial?.target_follower_max ? String(initial.target_follower_max) : "");
  const [startDate, setStartDate] = useState(initial?.campaign_start_date?.split("T")[0] || "");
  const [endDate, setEndDate] = useState(initial?.campaign_end_date?.split("T")[0] || "");
  const [applicationDeadline, setApplicationDeadline] = useState(initial?.application_deadline?.split("T")[0] || "");
  const [minEngagement, setMinEngagement] = useState(initial?.min_engagement_rate ? String(initial.min_engagement_rate) : "");

  const [numReels, setNumReels] = useState(initial?.deliverables?.reels ? String(initial.deliverables.reels) : "");
  const [numPosts, setNumPosts] = useState(initial?.deliverables?.posts ? String(initial.deliverables.posts) : "");
  const [numStories, setNumStories] = useState(initial?.deliverables?.stories ? String(initial.deliverables.stories) : "");
  const [numVideos, setNumVideos] = useState(initial?.deliverables?.videos ? String(initial.deliverables.videos) : "");
  const [numBlogs, setNumBlogs] = useState(initial?.deliverables?.blogs ? String(initial.deliverables.blogs) : "");

  const [shippingRequired, setShippingRequired] = useState<"no" | "yes" | "pickup">((initial?.shipping_required as "no" | "yes" | "pickup") || "no");
  const [shippingTimelineDays, setShippingTimelineDays] = useState(initial?.shipping_timeline_days ? String(initial.shipping_timeline_days) : "");
  const [serviceLocation, setServiceLocation] = useState(initial?.service_location || "");
  const [offeringType, setOfferingType] = useState<"product" | "service">(initial?.offering_type || "product");
  const [productName, setProductName] = useState(initial?.product_name || "");
  const [productValue, setProductValue] = useState(initial?.product_value ? String(initial.product_value) : "");
  const [barterCompensation, setBarterCompensation] = useState(initial?.barter_compensation || "");
  const [contentDos, setContentDos] = useState(initial?.content_dos || "");
  const [contentDonts, setContentDonts] = useState(initial?.content_donts || "");
  const [requiredHashtags, setRequiredHashtags] = useState(initial?.required_hashtags || "");
  const [brandHandlesToTag, setBrandHandlesToTag] = useState(initial?.brand_handles_to_tag || "");
  const [usageRights, setUsageRights] = useState(initial?.usage_rights || "");
  const [keepupDuration, setKeepupDuration] = useState(initial?.keepup_duration || "");
  const [exclusivityDays, setExclusivityDays] = useState(initial?.exclusivity_days || "");
  const [paymentTimeline, setPaymentTimeline] = useState(initial?.payment_timeline || "");

  const [selectedCategories, setSelectedCategories] = useState<string[]>(initial?.target_categories || []);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(initial?.platforms?.length ? initial.platforms : ["Instagram"]);
  const initialCities = initial?.target_cities || [];
  const [allIndia, setAllIndia] = useState(initialCities.includes("All India"));
  const [selectedCities, setSelectedCities] = useState<string[]>(initialCities.filter((c) => c !== "All India"));
  const [selectedGenders, setSelectedGenders] = useState<string[]>(initial?.target_gender || []);
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(initial?.target_languages || []);

  const [bannerImage, setBannerImage] = useState<ImagePreview | null>(null);
  // When editing, the existing banner URL is preserved unless the admin
  // picks a new file or clears it explicitly.
  const [existingBannerUrl, setExistingBannerUrl] = useState<string>(initial?.banner_image || "");
  const [galleryImages, setGalleryImages] = useState<ImagePreview[]>([]);
  const [existingGalleryUrls, setExistingGalleryUrls] = useState<string[]>(initial?.gallery_images || []);
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
    // Flip the spinner on immediately so the click feels acknowledged,
    // even if validation rejects below — we'll flip it back off in that
    // case. Otherwise the user sees nothing until uploads start, which
    // reads as a dead button.
    setLoading(true);
    setLoadingMsg(isEdit ? "Saving campaign..." : "Creating campaign...");
    setError("");

    if (totalDeliverables < 1) {
      setError("Add at least 1 deliverable");
      setLoading(false);
      return;
    }
    if (selectedCategories.length < 1) {
      setError("Select at least 1 category");
      setLoading(false);
      return;
    }
    if (selectedPlatforms.length < 1) {
      setError("Select at least 1 platform");
      setLoading(false);
      return;
    }

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

      // Banner: new file overrides existing; otherwise reuse the existing URL.
      if (bannerImage) {
        setLoadingMsg("Uploading banner image...");
        const bannerUrl = await uploadImage(bannerImage.file, "banners");
        if (bannerUrl) formData.append("banner_image_url", bannerUrl);
      } else if (existingBannerUrl) {
        formData.append("banner_image_url", existingBannerUrl);
      }

      // Gallery: keep the existing URLs the admin hasn't removed, then
      // append uploads from newly-picked files.
      for (const url of existingGalleryUrls) {
        formData.append("gallery_image_urls", url);
      }
      if (galleryImages.length > 0) {
        for (let i = 0; i < galleryImages.length; i++) {
          setLoadingMsg(`Uploading gallery image ${i + 1} of ${galleryImages.length}...`);
          const url = await uploadImage(galleryImages[i].file, "gallery");
          if (url) formData.append("gallery_image_urls", url);
        }
      }

      // Status is only set explicitly in edit mode — create defaults to "draft" server-side.
      if (isEdit) formData.append("status", status);

      setLoadingMsg(isEdit ? "Saving campaign..." : "Creating campaign...");
      const result = isEdit
        ? await updateCampaign(initial!.campaign_id, formData)
        : await createCampaign(formData);
      if (result.error) {
        setError(result.error);
        setLoading(false);
      } else {
        router.push(isEdit ? `/dashboard/campaigns/${initial!.campaign_id}` : "/dashboard/campaigns");
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent focus:bg-white dark:focus:bg-gray-800 transition-all";
  const labelClass = "block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5";

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
              <input
                name="title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Summer Fashion 2026"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Description</label>
              <textarea
                name="description"
                rows={5}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={DESCRIPTION_TEMPLATE}
                className={`${inputClass} resize-none`}
              />
              <p className="text-[11px] text-gray-400 mt-1">A guided template helps creators understand what you need.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Brand <span className="text-red-400">*</span></label>
                <select
                  name="brand_id"
                  required
                  value={brandSelect}
                  onChange={(e) => setBrandSelect(e.target.value)}
                  className={inputClass}
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
            {isEdit && (
              <div>
                <label className={labelClass}>Status</label>
                <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="completed">Completed</option>
                </select>
              </div>
            )}
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
                    value={productValue}
                    onChange={(e) => setProductValue(e.target.value)}
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
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
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
                      value={shippingTimelineDays}
                      onChange={(e) => setShippingTimelineDays(e.target.value)}
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
                  value={serviceLocation}
                  onChange={(e) => setServiceLocation(e.target.value)}
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
                  value={barterCompensation}
                  onChange={(e) => setBarterCompensation(e.target.value)}
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
            ) : existingBannerUrl ? (
              <div className="relative group rounded-xl overflow-hidden">
                <img src={existingBannerUrl} alt="Existing banner" className="w-full h-48 object-cover" />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    className="opacity-0 group-hover:opacity-100 transition-opacity px-4 py-2 rounded-xl bg-white/90 text-gray-700 font-medium text-sm cursor-pointer shadow-lg"
                  >
                    Replace
                  </button>
                  <button
                    type="button"
                    onClick={() => setExistingBannerUrl("")}
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
            {(existingGalleryUrls.length > 0 || galleryImages.length > 0) && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {existingGalleryUrls.map((url, i) => (
                  <div key={`existing-${i}`} className="relative group aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
                    <img src={url} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setExistingGalleryUrls((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-white/90 text-red-600 cursor-pointer shadow"
                    >
                      ×
                    </button>
                  </div>
                ))}
                {galleryImages.map((img, i) => (
                  <div key={`new-${i}`} className="relative group aspect-square rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
                    <img src={img.url} alt={`Gallery ${i + 1}`} className="w-full h-full object-cover" />
                    <span className="absolute top-1.5 left-1.5 text-[9px] px-1.5 py-0.5 rounded bg-indigo-600 text-white font-bold">NEW</span>
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
                {(galleryImages.length > 0 || existingGalleryUrls.length > 0) ? "Add more images" : "Click or drag to upload images"}
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
              <input
                name="min_engagement_rate"
                type="number"
                min="0"
                step="0.1"
                value={minEngagement}
                onChange={(e) => setMinEngagement(e.target.value)}
                placeholder="2.5"
                className={inputClass}
              />
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
              <textarea
                name="content_dos"
                rows={2}
                value={contentDos}
                onChange={(e) => setContentDos(e.target.value)}
                placeholder='"Show product packaging, mention discount code SAVE20"'
                className={`${inputClass} resize-none`}
              />
            </div>
            <div>
              <label className={labelClass}>Must avoid (Don&apos;ts)</label>
              <textarea
                name="content_donts"
                rows={2}
                value={contentDonts}
                onChange={(e) => setContentDonts(e.target.value)}
                placeholder='"No competitor products, no copyrighted music"'
                className={`${inputClass} resize-none`}
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Required hashtags</label>
                <input
                  name="required_hashtags"
                  type="text"
                  value={requiredHashtags}
                  onChange={(e) => setRequiredHashtags(e.target.value)}
                  placeholder="#RGossips #Ad #Paidpartnership"
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Brand handle(s) to tag</label>
                <input
                  name="brand_handles_to_tag"
                  type="text"
                  value={brandHandlesToTag}
                  onChange={(e) => setBrandHandlesToTag(e.target.value)}
                  placeholder="@yourbrand"
                  className={inputClass}
                />
              </div>
            </div>
          </Card>

          <Card title="Terms & rights">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Content usage rights</label>
                <select
                  name="usage_rights"
                  value={usageRights || "creator_only"}
                  onChange={(e) => setUsageRights(e.target.value)}
                  className={inputClass}
                >
                  <option value="creator_only">Influencer&apos;s page only</option>
                  <option value="brand_repost">Brand can repost</option>
                  <option value="paid_ads">Brand can use in paid ads</option>
                  <option value="full_rights">Full rights transfer</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Content keep-up duration</label>
                <select
                  name="keepup_duration"
                  value={keepupDuration || "permanent"}
                  onChange={(e) => setKeepupDuration(e.target.value)}
                  className={inputClass}
                >
                  <option value="24h">24 hours (stories)</option>
                  <option value="7d">7 days</option>
                  <option value="30d">30 days</option>
                  <option value="permanent">Permanent</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Exclusivity (no competing brands)</label>
                <select
                  name="exclusivity_days"
                  value={exclusivityDays || "0"}
                  onChange={(e) => setExclusivityDays(e.target.value)}
                  className={inputClass}
                >
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
                  <select
                    name="payment_timeline"
                    value={paymentTimeline || "on_approval"}
                    onChange={(e) => setPaymentTimeline(e.target.value)}
                    className={inputClass}
                  >
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
              <input
                name="campaign_start_date"
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Application Deadline <span className="text-red-400">*</span></label>
              <input
                name="application_deadline"
                type="date"
                required
                value={applicationDeadline}
                onChange={(e) => setApplicationDeadline(e.target.value)}
                className={inputClass}
              />
              <p className="text-[11px] text-gray-400 mt-1">Last day for influencers to apply.</p>
            </div>
            <div>
              <label className={labelClass}>Campaign End Date <span className="text-red-400">*</span></label>
              <input
                name="campaign_end_date"
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={inputClass}
              />
              <p className="text-[11px] text-gray-400 mt-1">All content must be delivered by this date.</p>
            </div>
          </Card>

          <Card title={isEdit ? "Save changes" : "Submit"}>
            <button
              type="submit"
              disabled={loading}
              aria-busy={loading}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 active:from-indigo-700 active:to-purple-700 active:scale-[0.98] disabled:opacity-70 disabled:cursor-wait text-white text-sm font-semibold cursor-pointer shadow-lg transition-all"
            >
              {loading && (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {loading
                ? (loadingMsg || (isEdit ? "Saving..." : "Creating..."))
                : (isEdit ? "Save Changes" : "Create Campaign")}
            </button>
            <button
              type="button"
              onClick={() => router.push(isEdit ? `/dashboard/campaigns/${initial!.campaign_id}` : "/dashboard/campaigns")}
              className="w-full px-6 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 text-gray-600 text-sm font-medium cursor-pointer"
            >
              Cancel
            </button>
            {!isEdit && <p className="text-[11px] text-gray-400 text-center">Campaign will be created as a draft</p>}
          </Card>
        </div>
      </div>
    </form>
  );
}
