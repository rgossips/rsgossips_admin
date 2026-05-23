"use client";

import { useState, useTransition } from "react";
import { searchInfluencersForStory, uploadStoryVideo } from "../actions";

type Initial = {
  influencer_id?: string | null;
  username?: string;
  avatar_url?: string;
  video_url?: string;
  poster_url?: string;
  position?: number;
  is_active?: boolean;
};

const formatFollowers = (n: number) => {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
};

export function CreatorStoryForm({
  action,
  initial,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<{ error?: string }>;
  initial?: Initial;
  submitLabel: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [state, setState] = useState({
    influencer_id: initial?.influencer_id || "",
    username: initial?.username || "",
    avatar_url: initial?.avatar_url || "",
    video_url: initial?.video_url || "",
    poster_url: initial?.poster_url || "",
    position: initial?.position ?? 0,
    is_active: initial?.is_active ?? true,
  });

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerResults, setPickerResults] = useState<any[]>([]);
  const [pickerSearching, setPickerSearching] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const searchPicker = async (q: string) => {
    setPickerQuery(q);
    if (q.trim().length < 2) {
      setPickerResults([]);
      return;
    }
    setPickerSearching(true);
    const rows = await searchInfluencersForStory(q);
    setPickerResults(rows);
    setPickerSearching(false);
  };

  const pickInfluencer = (inf: any) => {
    const handle = inf.instagram_handle || inf.username || "";
    setState((prev) => ({
      ...prev,
      influencer_id: inf.influencer_id,
      username: handle,
      avatar_url: inf.custom_profile_photo_url || inf.profile_photo_url || prev.avatar_url,
    }));
    setPickerOpen(false);
    setPickerQuery("");
    setPickerResults([]);
  };

  const onUploadVideo = async (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await uploadStoryVideo(fd);
      if (res.error) setUploadError(res.error);
      else if (res.url) setState((prev) => ({ ...prev, video_url: res.url! }));
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const res = await action(formData);
      if (res?.error) setError(res.error);
    });
  };

  return (
    <form action={onSubmit} className="space-y-6">
      <input type="hidden" name="influencer_id" value={state.influencer_id} />

      <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800 rounded-xl p-4 flex items-center gap-4">
        <div className="flex-1">
          <p className="text-sm font-semibold text-indigo-900 dark:text-indigo-200">Attach an existing influencer</p>
          <p className="text-[12px] text-indigo-700 dark:text-indigo-300/80">Auto-fills the username and avatar.</p>
        </div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[12px] font-semibold cursor-pointer"
        >
          Search creators
        </button>
      </div>

      <Field label="Instagram username" name="username" value={state.username} onChange={(v) => setState({ ...state, username: v.replace(/^@/, "") })} placeholder="cristiano" />

      <Field label="Avatar URL" name="avatar_url" value={state.avatar_url} onChange={(v) => setState({ ...state, avatar_url: v })} placeholder="https://…/photo.jpg" />
      {state.avatar_url && (
        <div className="flex items-center gap-3">
          <img
            src={state.avatar_url}
            alt="avatar"
            className="w-14 h-14 rounded-full object-cover border border-gray-200"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <span className="text-[11px] text-gray-400">preview</span>
        </div>
      )}

      {/* Video — upload OR paste URL */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">Video</span>
          <span className="text-[10px] text-gray-400">MP4, up to 50 MB</span>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            name="video_url"
            type="text"
            value={state.video_url}
            onChange={(e) => setState({ ...state, video_url: e.target.value })}
            placeholder="Paste a hosted video URL"
            className="flex-1 px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-indigo-400"
          />
          <label className={`px-3 py-2.5 rounded-lg border border-dashed text-[12px] font-semibold text-center cursor-pointer ${uploading ? "border-indigo-200 text-indigo-400" : "border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20"}`}>
            {uploading ? "Uploading…" : "Upload from device"}
            <input
              type="file"
              accept="video/*"
              hidden
              onChange={(e) => onUploadVideo(e.target.files?.[0] || null)}
            />
          </label>
        </div>
        {uploadError && <p className="text-[11px] text-red-600">{uploadError}</p>}
        {state.video_url && (
          <video
            src={state.video_url}
            className="rounded-lg max-h-64 border border-gray-200"
            controls
            preload="metadata"
          />
        )}
      </div>

      <Field label="Poster image URL (optional)" name="poster_url" value={state.poster_url} onChange={(v) => setState({ ...state, poster_url: v })} placeholder="https://…/poster.jpg" hint="Thumbnail shown before the video loads." />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Position" name="position" value={String(state.position)} onChange={(v) => setState({ ...state, position: Number(v) || 0 })} type="number" hint="Lower numbers appear first." />
        <Toggle label="Active (visible to brands)" name="is_active" checked={state.is_active} onChange={(v) => setState({ ...state, is_active: v })} />
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
          {pending ? "Saving…" : submitLabel}
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
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider">{label}</span>
      <input
        name={name}
        type={type}
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 w-[min(560px,95vw)] max-h-[85vh] flex flex-col rounded-2xl border border-gray-200 dark:border-gray-800 shadow-2xl">
        <div className="p-4 border-b border-gray-100 dark:border-gray-800">
          <input
            type="text"
            autoFocus
            placeholder="Search by handle, name or username…"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm outline-none focus:border-indigo-400"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {searching ? (
            <div className="text-center text-sm text-gray-400 py-8">Searching…</div>
          ) : results.length === 0 ? (
            <div className="text-center text-sm text-gray-400 py-8">
              {query.trim().length < 2 ? "Type at least 2 characters." : "No matches."}
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
                    <p className="text-[12px] text-gray-500 truncate">@{handle} · {formatFollowers(inf.followers_count || 0) || "?"} followers</p>
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
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
