"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Same shape as a service row. We only show the columns that the admin
// actually edits — generated stuff (id, rating_avg, reviews_count,
// booked_this_month, created_at, updated_at) is read-only / system-driven.
type Service = {
  id?: string;
  slug?: string;
  tag?: string;
  title?: string;
  description?: string;
  about?: string;
  included?: any;
  packages?: any;
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
  submitLabel = "Save Service",
}: {
  initial?: Service;
  action: (formData: FormData) => Promise<{ error?: string }>;
  submitLabel?: string;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  // Pretty-print jsonb arrays for editing.
  const includedDefault = JSON.stringify(initial?.included ?? [], null, 2);
  const packagesDefault = JSON.stringify(initial?.packages ?? [], null, 2);

  const onSubmit = async (formData: FormData) => {
    setError("");
    setPending(true);
    try {
      const res = await action(formData);
      if (res?.error) {
        setError(res.error);
        setPending(false);
      }
      // On success the action redirects — no further state changes needed.
    } catch (e: any) {
      setError(e?.message || "Failed to save");
      setPending(false);
    }
  };

  return (
    <form action={onSubmit} className="space-y-6 max-w-3xl">
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Basics */}
      <Card title="Basics">
        <Row>
          <Field label="Title" required>
            <input
              name="title"
              defaultValue={initial?.title || ""}
              required
              className="input"
              placeholder="e.g. Aesthetic Reel Production — Pro Video Editing"
            />
          </Field>
        </Row>
        <Row cols={2}>
          <Field label="Slug" hint="URL-safe identifier. Leave blank to auto-generate from title.">
            <input
              name="slug"
              defaultValue={initial?.slug || ""}
              className="input"
              placeholder="aesthetic-reel"
              pattern="^[a-z0-9-]+$"
            />
          </Field>
          <Field label="Tag" required hint="Uppercase category (CONTENT / ADS / DESIGN …)">
            <input
              name="tag"
              defaultValue={initial?.tag || ""}
              required
              className="input uppercase"
              placeholder="CONTENT"
            />
          </Field>
        </Row>
        <Row>
          <Field label="Short description" hint="Appears on the card under the title">
            <input
              name="description"
              defaultValue={initial?.description || ""}
              className="input"
              placeholder="Cinematic Reel edits from your raw footage — trending audio, dynamic captions"
            />
          </Field>
        </Row>
        <Row>
          <Field label="About this service" hint="Long-form paragraph shown on the detail page">
            <textarea
              name="about"
              defaultValue={initial?.about || ""}
              rows={4}
              className="input resize-none"
            />
          </Field>
        </Row>
      </Card>

      {/* Pricing */}
      <Card title="Pricing">
        <Row cols={3}>
          <Field label="Starting price (₹)" required>
            <input
              name="price_starting"
              defaultValue={initial?.price_starting ?? 0}
              type="number"
              min={0}
              required
              className="input"
            />
          </Field>
          <Field label="Upper price (₹)" hint='Used for "Most X priced between Y–Z"'>
            <input
              name="price_to"
              defaultValue={initial?.price_to ?? ""}
              type="number"
              min={0}
              className="input"
            />
          </Field>
          <Field label="Suffix" hint='e.g. "/mo" for subscription'>
            <input
              name="price_suffix"
              defaultValue={initial?.price_suffix ?? ""}
              className="input"
              placeholder=""
            />
          </Field>
        </Row>
      </Card>

      {/* What's included */}
      <Card title="What's included" subtitle='JSON array of strings, e.g. ["First", "Second", …]'>
        <textarea
          name="included"
          defaultValue={includedDefault}
          rows={6}
          className="input font-mono text-[12px]"
          placeholder='["Full edit of provided raw footage", "Trending audio licensing & sync"]'
        />
      </Card>

      {/* Packages */}
      <Card title="Typical packages" subtitle='JSON array of { "name", "spec", "price" }'>
        <textarea
          name="packages"
          defaultValue={packagesDefault}
          rows={8}
          className="input font-mono text-[12px]"
          placeholder='[{"name":"Basic Reel","spec":"15-30 sec, 1 revision","price":2500}]'
        />
      </Card>

      {/* Service-level metadata */}
      <Card title="Logistics">
        <Row cols={3}>
          <Field label="Quote SLA (hours)" required>
            <input
              name="quote_sla_hours"
              defaultValue={initial?.quote_sla_hours ?? 24}
              type="number"
              min={1}
              required
              className="input"
            />
          </Field>
          <Field label="Delivery days" hint='Free text like "3-7 d" or "Ongoing"'>
            <input
              name="delivery_days"
              defaultValue={initial?.delivery_days || ""}
              className="input"
              placeholder="3-7 d"
            />
          </Field>
          <Field label="Payment split" hint='e.g. "50/50" or "100% upfront"'>
            <input
              name="payment_split"
              defaultValue={initial?.payment_split || "50/50"}
              className="input"
              placeholder="50/50"
            />
          </Field>
        </Row>
      </Card>

      {/* Visual */}
      <Card title="Visual">
        <Row cols={3}>
          <Field label="Icon" hint="Lucide icon name">
            <select name="icon_name" defaultValue={initial?.icon_name || "Sparkles"} className="input">
              {ICONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Accent (Tailwind classes)">
            <select name="accent" defaultValue={initial?.accent || ACCENT_PRESETS[0]} className="input">
              {ACCENT_PRESETS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Hero gradient (Tailwind from-via-to)">
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

      {/* Visibility */}
      <Card title="Visibility">
        <Row cols={2}>
          <Field label="Display order" hint="Lower = earlier in the list">
            <input
              name="display_order"
              defaultValue={initial?.display_order ?? 0}
              type="number"
              className="input"
            />
          </Field>
          <Field label="Active" hint="Inactive services are hidden from the influencer app">
            <label className="inline-flex items-center gap-2 mt-2">
              <input
                name="is_active"
                type="checkbox"
                defaultChecked={initial?.is_active ?? true}
                className="w-4 h-4"
              />
              <span className="text-sm text-gray-700 dark:text-gray-200">Service is active</span>
            </label>
          </Field>
        </Row>
      </Card>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => router.push("/dashboard/services")}
          className="px-5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-5 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
        >
          {pending ? "Saving…" : submitLabel}
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
