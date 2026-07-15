"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { uploadServiceImage } from "../actions";

type GalleryItem = { type: "image" | "video"; url: string; caption?: string };
type Pkg = { name: string; spec: string; price: number | string };

type Service = {
  id?: string;
  slug?: string;
  tag?: string;
  title?: string;
  description?: string;
  about?: string;
  included?: string[];
  packages?: Pkg[];
  price_starting?: number;
  price_to?: number | null;
  price_suffix?: string | null;
  quote_sla_hours?: number;
  delivery_days?: string;
  payment_split?: string;
  hero_gradient?: string;
  accent?: string;
  icon_name?: string;
  is_active?: boolean;
  display_order?: number;
  featured_image_url?: string | null;
  gallery?: GalleryItem[];
};

const ICONS = [
  "Sparkles",
  "Instagram",
  "Target",
  "Palette",
  "LineChart",
  "Camera",
  "PenSquare",
  "Megaphone",
  "Mic",
  "Film",
];

const GRADIENT_PRESETS = [
  "from-violet-500 via-fuchsia-500 to-pink-500",
  "from-indigo-500 via-violet-500 to-fuchsia-500",
  "from-orange-500 via-rose-500 to-pink-500",
  "from-emerald-500 via-teal-500 to-cyan-500",
  "from-amber-500 via-orange-500 to-rose-500",
  "from-pink-500 via-rose-500 to-orange-500",
  "from-sky-500 via-blue-500 to-indigo-500",
  "from-fuchsia-500 via-pink-500 to-rose-500",
  "from-indigo-500 via-blue-500 to-cyan-500",
];

const ACCENT_PRESETS = [
  "bg-rose-100 text-rose-600",
  "bg-violet-100 text-violet-600",
  "bg-orange-100 text-orange-600",
  "bg-emerald-100 text-emerald-600",
  "bg-amber-100 text-amber-600",
  "bg-sky-100 text-sky-600",
  "bg-pink-100 text-pink-600",
  "bg-indigo-100 text-indigo-600",
];

export function ServiceForm({
  initial,
  action,
  submitLabel,
}: {
  initial?: Service;
  action: (formData: FormData) => Promise<{ error?: string }>;
  submitLabel?: string;
}) {
  const t = useTranslations("DashboardServicesFormServiceForm");
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  // Stateful arrays for the dynamic UIs.
  const [included, setIncluded] = useState<string[]>(initial?.included?.length ? initial.included : [""]);
  const [packages, setPackages] = useState<Pkg[]>(
    initial?.packages?.length ? initial.packages : [{ name: "", spec: "", price: "" }]
  );
  const [featuredImage, setFeaturedImage] = useState<string>(initial?.featured_image_url || "");
  const [gallery, setGallery] = useState<GalleryItem[]>(initial?.gallery?.length ? initial.gallery : []);

  // Uploads
  const [featuredUploading, setFeaturedUploading] = useState(false);
  const [galleryUploading, setGalleryUploading] = useState(false);

  const handleFeaturedUpload = async (file: File) => {
    setFeaturedUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadServiceImage(fd);
    setFeaturedUploading(false);
    if (res?.error) setError(res.error);
    else if (res?.url) setFeaturedImage(res.url);
  };

  const handleGalleryUpload = async (file: File) => {
    setGalleryUploading(true);
    const fd = new FormData();
    fd.set("file", file);
    const res = await uploadServiceImage(fd);
    setGalleryUploading(false);
    if (res?.error) setError(res.error);
    else if (res?.url) setGallery((prev) => [...prev, { type: "image", url: res.url!, caption: "" }]);
  };

  const onSubmit = (formData: FormData) => {
    // Hydrate the FormData with our stateful arrays before sending.
    formData.set(
      "included",
      JSON.stringify(included.map((s) => s.trim()).filter(Boolean))
    );
    formData.set(
      "packages",
      JSON.stringify(
        packages
          .map((p) => ({
            name: (p.name || "").toString().trim(),
            spec: (p.spec || "").toString().trim(),
            price: Number(p.price) || 0,
          }))
          .filter((p) => p.name)
      )
    );
    formData.set("featured_image_url", featuredImage);
    formData.set("gallery", JSON.stringify(gallery));

    setError("");
    startTransition(async () => {
      const res = await action(formData);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <form action={onSubmit} className="space-y-6">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ── TWO-COLUMN LAYOUT ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* ── LEFT COLUMN ── */}
        <div className="space-y-6">
          <Card title={t("basics.title")}>
            <Field label={t("fields.title.label")} required>
              <input
                name="title"
                defaultValue={initial?.title || ""}
                required
                className="input"
                placeholder={t("fields.title.placeholder")}
              />
            </Field>
            <Row cols={2}>
              <Field label={t("fields.slug.label")} hint={t("fields.slug.hint")}>
                <input
                  name="slug"
                  defaultValue={initial?.slug || ""}
                  className="input"
                  placeholder="aesthetic-reel"
                  pattern="^[a-z0-9-]+$"
                />
              </Field>
              <Field label={t("fields.tag.label")} required hint={t("fields.tag.hint")}>
                <input
                  name="tag"
                  defaultValue={initial?.tag || ""}
                  required
                  className="input uppercase"
                  placeholder="CONTENT"
                />
              </Field>
            </Row>
            <Field label={t("fields.description.label")} hint={t("fields.description.hint")}>
              <input
                name="description"
                defaultValue={initial?.description || ""}
                className="input"
                placeholder={t("fields.description.placeholder")}
              />
            </Field>
            <Field label={t("fields.about.label")} hint={t("fields.about.hint")}>
              <textarea
                name="about"
                defaultValue={initial?.about || ""}
                rows={4}
                className="input resize-none"
              />
            </Field>
          </Card>

          <Card title={t("pricing.title")}>
            <Row cols={3}>
              <Field label={t("fields.priceStarting.label")} required>
                <input
                  name="price_starting"
                  defaultValue={initial?.price_starting ?? 0}
                  type="number"
                  min={0}
                  required
                  className="input"
                />
              </Field>
              <Field label={t("fields.priceTo.label")} hint={t("fields.priceTo.hint")}>
                <input
                  name="price_to"
                  defaultValue={initial?.price_to ?? ""}
                  type="number"
                  min={0}
                  className="input"
                />
              </Field>
              <Field label={t("fields.suffix.label")} hint={t("fields.suffix.hint")}>
                <input
                  name="price_suffix"
                  defaultValue={initial?.price_suffix ?? ""}
                  className="input"
                  placeholder=""
                />
              </Field>
            </Row>
          </Card>

          <Card title={t("included.title")} subtitle={t("included.subtitle")}>
            <div className="space-y-2">
              {included.map((item, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={item}
                    onChange={(e) => setIncluded((prev) => prev.map((x, idx) => (idx === i ? e.target.value : x)))}
                    placeholder={t("included.placeholder", { n: i + 1 })}
                    className="input flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setIncluded((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={included.length === 1}
                    className="shrink-0 px-2 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-400 hover:text-rose-500 disabled:opacity-30 cursor-pointer"
                    aria-label={t("included.remove")}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setIncluded((prev) => [...prev, ""])}
                className="text-[12px] font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                {t("included.addAnother")}
              </button>
            </div>
          </Card>

          <Card title={t("packages.title")} subtitle={t("packages.subtitle")}>
            <div className="space-y-3">
              {packages.map((pkg, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-700 rounded-lg p-3 space-y-2">
                  <div className="grid grid-cols-12 gap-2">
                    <input
                      value={pkg.name}
                      onChange={(e) =>
                        setPackages((prev) => prev.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x)))
                      }
                      placeholder={t("packages.namePlaceholder")}
                      className="input col-span-12 sm:col-span-5"
                    />
                    <input
                      value={pkg.spec}
                      onChange={(e) =>
                        setPackages((prev) => prev.map((x, idx) => (idx === i ? { ...x, spec: e.target.value } : x)))
                      }
                      placeholder={t("packages.specPlaceholder")}
                      className="input col-span-9 sm:col-span-5"
                    />
                    <input
                      value={pkg.price}
                      onChange={(e) =>
                        setPackages((prev) => prev.map((x, idx) => (idx === i ? { ...x, price: e.target.value } : x)))
                      }
                      placeholder={t("packages.pricePlaceholder")}
                      type="number"
                      className="input col-span-3 sm:col-span-2"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setPackages((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={packages.length === 1}
                    className="text-[11px] font-bold text-rose-500 hover:underline disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {t("packages.remove")}
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setPackages((prev) => [...prev, { name: "", spec: "", price: "" }])}
                className="text-[12px] font-semibold text-indigo-600 hover:underline cursor-pointer"
              >
                {t("packages.addAnother")}
              </button>
            </div>
          </Card>
        </div>

        {/* ── RIGHT COLUMN ── */}
        <div className="space-y-6">
          <Card title={t("featured.title")} subtitle={t("featured.subtitle")}>
            {featuredImage ? (
              <div className="space-y-2">
                <div className="aspect-[2.4/1] rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={featuredImage} alt={t("featured.imageAlt")} className="w-full h-full object-cover" />
                </div>
                <div className="flex gap-2">
                  <label className="flex-1 cursor-pointer text-center px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-[12px] font-semibold text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800">
                    {t("featured.replace")}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => e.target.files?.[0] && handleFeaturedUpload(e.target.files[0])}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => setFeaturedImage("")}
                    className="px-3 py-2 rounded-lg border border-rose-200 text-rose-500 text-[12px] font-semibold hover:bg-rose-50 cursor-pointer"
                  >
                    {t("featured.remove")}
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center gap-2 cursor-pointer aspect-[2.4/1] rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700 bg-gray-50 dark:bg-gray-800/40 transition-colors">
                {featuredUploading ? (
                  <span className="text-[12px] font-semibold text-gray-500">{t("featured.uploading")}</span>
                ) : (
                  <>
                    <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                    </svg>
                    <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-200">{t("featured.upload")}</p>
                    <p className="text-[10px] text-gray-400">{t("featured.uploadHint")}</p>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFeaturedUpload(e.target.files[0])}
                />
              </label>
            )}
          </Card>

          <Card title={t("gallery.title")} subtitle={t("gallery.subtitle")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {gallery.map((g, i) => (
                <GalleryTile
                  key={i}
                  item={g}
                  onUpdate={(patch) => setGallery((prev) => prev.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))}
                  onRemove={() => setGallery((prev) => prev.filter((_, idx) => idx !== i))}
                />
              ))}
              {/* Upload tile */}
              <label className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 bg-gray-50 dark:bg-gray-800/40">
                {galleryUploading ? (
                  <span className="text-[11px] font-semibold text-gray-500">{t("gallery.uploading")}</span>
                ) : (
                  <>
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                    </svg>
                    <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{t("gallery.addImage")}</p>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleGalleryUpload(e.target.files[0])}
                />
              </label>
              {/* Add video tile */}
              <button
                type="button"
                onClick={() =>
                  setGallery((prev) => [...prev, { type: "video", url: "", caption: "" }])
                }
                className="aspect-[4/3] rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700 bg-gray-50 dark:bg-gray-800/40"
              >
                <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-[11px] font-semibold text-gray-600 dark:text-gray-300">{t("gallery.addVideo")}</p>
              </button>
            </div>
          </Card>

          <Card title={t("logistics.title")}>
            <Row cols={3}>
              <Field label={t("fields.quoteSla.label")} required>
                <input
                  name="quote_sla_hours"
                  defaultValue={initial?.quote_sla_hours ?? 24}
                  type="number"
                  min={1}
                  required
                  className="input"
                />
              </Field>
              <Field label={t("fields.deliveryDays.label")} hint={t("fields.deliveryDays.hint")}>
                <input
                  name="delivery_days"
                  defaultValue={initial?.delivery_days || ""}
                  className="input"
                  placeholder="3-7 d"
                />
              </Field>
              <Field label={t("fields.paymentSplit.label")}>
                <input
                  name="payment_split"
                  defaultValue={initial?.payment_split || "50/50"}
                  className="input"
                  placeholder="50/50"
                />
              </Field>
            </Row>
          </Card>

          <Card title={t("presets.title")} subtitle={t("presets.subtitle")}>
            <Row cols={3}>
              <Field label={t("fields.icon.label")} hint={t("fields.icon.hint")}>
                <select name="icon_name" defaultValue={initial?.icon_name || "Sparkles"} className="input">
                  {ICONS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("fields.accent.label")}>
                <select name="accent" defaultValue={initial?.accent || ACCENT_PRESETS[0]} className="input">
                  {ACCENT_PRESETS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("fields.gradient.label")}>
                <select name="hero_gradient" defaultValue={initial?.hero_gradient || GRADIENT_PRESETS[0]} className="input">
                  {GRADIENT_PRESETS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </Field>
            </Row>
          </Card>

          <Card title={t("visibility.title")}>
            <Row cols={2}>
              <Field label={t("fields.displayOrder.label")} hint={t("fields.displayOrder.hint")}>
                <input
                  name="display_order"
                  defaultValue={initial?.display_order ?? 0}
                  type="number"
                  className="input"
                />
              </Field>
              <Field label={t("fields.active.label")}>
                <label className="inline-flex items-center gap-2 mt-2">
                  <input
                    name="is_active"
                    type="checkbox"
                    defaultChecked={initial?.is_active ?? true}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-200">{t("fields.active.checkbox")}</span>
                </label>
              </Field>
            </Row>
          </Card>
        </div>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => router.push("/dashboard/services")}
          className="px-5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        >
          {t("cancel")}
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
        >
          {pending ? t("saving") : (submitLabel ?? t("saveDefault"))}
        </button>
      </div>

      <style jsx global>{`
        .input {
          width: 100%;
          padding: 0.55rem 0.85rem;
          border-radius: 0.6rem;
          border: 1px solid rgb(229 231 235);
          background: white;
          font-size: 13px;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
        }
        .input:focus {
          border-color: rgb(99 102 241);
          box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
        }
        .dark .input {
          background: rgb(17 24 39);
          border-color: rgb(55 65 81);
          color: rgb(229 231 235);
        }
      `}</style>
    </form>
  );
}

function GalleryTile({
  item,
  onUpdate,
  onRemove,
}: {
  item: GalleryItem;
  onUpdate: (patch: Partial<GalleryItem>) => void;
  onRemove: () => void;
}) {
  const t = useTranslations("DashboardServicesFormServiceForm");
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-900">
      <div className="aspect-[4/3] bg-gray-100 dark:bg-gray-800 relative">
        {item.type === "image" && item.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.url} alt={item.caption || ""} className="w-full h-full object-cover" />
        )}
        {item.type === "video" && (
          <div className="w-full h-full flex items-center justify-center text-slate-400">
            <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        )}
        <span className="absolute top-1.5 left-1.5 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/60 text-white">
          {item.type}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-black/60 text-white hover:bg-rose-500 flex items-center justify-center text-xs cursor-pointer"
          aria-label={t("gallery.remove")}
        >
          ✕
        </button>
      </div>
      <div className="p-2 space-y-1.5">
        {item.type === "video" && (
          <input
            value={item.url}
            onChange={(e) => onUpdate({ url: e.target.value })}
            placeholder="https://youtube.com/… / vimeo.com/…"
            className="input text-[11px]"
          />
        )}
        <input
          value={item.caption || ""}
          onChange={(e) => onUpdate({ caption: e.target.value })}
          placeholder={t("gallery.captionPlaceholder")}
          className="input text-[11px]"
        />
      </div>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
        {subtitle && (
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{subtitle}</p>
        )}
      </div>
      {children}
    </div>
  );
}

function Row({ children, cols = 1 }: { children: React.ReactNode; cols?: 1 | 2 | 3 }) {
  const gridClass =
    cols === 3
      ? "grid grid-cols-1 sm:grid-cols-3 gap-4"
      : cols === 2
        ? "grid grid-cols-1 sm:grid-cols-2 gap-4"
        : "space-y-4";
  return <div className={gridClass}>{children}</div>;
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-[12px] font-semibold text-gray-700 dark:text-gray-200 mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1">{hint}</p>
      )}
    </div>
  );
}
