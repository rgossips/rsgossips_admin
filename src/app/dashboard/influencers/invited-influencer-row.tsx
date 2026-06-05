"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ButtonSpinner } from "@/components/spinner";
import { deleteInfluencerInvitation, updateInfluencerInvitation } from "./actions";
import { sendInfluencerInvitationEmail } from "./invitation-email-actions";
import { Avatar } from "@/components/avatar";
import { INDIAN_CITIES } from "@/lib/cities";
import { useRole } from "@/components/role-context";
import { SendInviteEmailModal } from "@/components/send-invite-email-modal";

interface Invitation {
  id: string;
  full_name: string;
  instagram_username: string;
  profile_photo_url: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

function parseMeta(notes: string | null) {
  if (!notes) return { text: "", meta: null };
  const sep = notes.indexOf("\n---\n");
  const text = sep !== -1 ? notes.slice(0, sep) : (notes.startsWith("{") ? "" : notes);
  let meta: any = null;
  try { meta = JSON.parse(sep !== -1 ? notes.slice(sep + 5) : (notes.startsWith("{") ? notes : "")); } catch {}
  return { text, meta };
}

export function InvitedInfluencerRow({ invitation }: { invitation: Invitation }) {
  const { isAdmin } = useRole();
  const [loading, setLoading] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [editing, setEditing] = useState(false);
  const [emailing, setEmailing] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Remove invitation for @${invitation.instagram_username}?`)) return;
    setLoading(true);
    const result = await deleteInfluencerInvitation(invitation.id);
    if (result.error) alert(result.error);
    else setRemoved(true);
    setLoading(false);
  };

  if (removed) return null;

  const { text, meta } = parseMeta(invitation.notes);

  return (
    <>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl p-5 hover:shadow-lg hover:shadow-gray-200/50 dark:hover:shadow-gray-900/50 transition-all duration-300">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <Avatar src={invitation.profile_photo_url} name={invitation.full_name} size="lg" shape="rounded" />
            <div>
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{invitation.full_name}</h3>
              <p className="text-xs text-gray-400 dark:text-gray-500">@{invitation.instagram_username}</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Awaiting Claim
          </span>
        </div>

        {(text || meta) && (
          <div className="mb-3 space-y-1.5">
            {text && <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2">{text}</p>}
            <div className="flex flex-wrap gap-1">
              {meta?.city && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 text-[10px] font-semibold">
                  <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>
                  {meta.city}
                </span>
              )}
              {meta?.categories?.map((c: string) => <span key={c} className="px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 text-[10px] font-semibold">{c}</span>)}
              {meta?.languages?.map((l: string) => <span key={l} className="px-2 py-0.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-[10px] font-semibold">{l}</span>)}
              {meta?.tags?.map((t: string) => <span key={t} className="px-2 py-0.5 rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-[10px] font-medium">#{t}</span>)}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-gray-100 dark:border-gray-800">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">Created {new Date(invitation.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
          {isAdmin && (
            <div className="flex items-center gap-3">
              <button onClick={() => setEmailing(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700 cursor-pointer">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                Send invite
              </button>
              <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-500 hover:text-indigo-600 cursor-pointer">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                Edit
              </button>
              <button onClick={handleDelete} disabled={loading} className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-500 hover:text-red-600 cursor-pointer disabled:opacity-50">
                {loading ? <ButtonSpinner /> : <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                Remove
              </button>
            </div>
          )}
        </div>
      </div>

      {editing && <EditInfluencerInviteModal invitation={invitation} text={text} meta={meta} onClose={() => setEditing(false)} />}
      <SendInviteEmailModal
        open={emailing}
        onClose={() => setEmailing(false)}
        recipientLabel={`${invitation.full_name} (@${invitation.instagram_username})`}
        send={(email, customMessage) => sendInfluencerInvitationEmail(invitation.id, email, customMessage)}
      />
    </>
  );
}

const inputClass = "w-full px-4 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all";

function EditInfluencerInviteModal({ invitation, text, meta, onClose }: { invitation: Invitation; text: string; meta: any; onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (formData: FormData) => {
    setError(""); setLoading(true);
    const result = await updateInfluencerInvitation(invitation.id, formData);
    if (result.error) { setError(result.error); setLoading(false); }
    else { router.refresh(); onClose(); }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed z-50 inset-4 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-lg lg:max-h-[80vh] bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h2 className="text-base font-bold text-gray-900 dark:text-white">Edit Influencer Invitation</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form action={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {error && <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/30 text-red-600 text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Full Name *</label>
              <input name="full_name" required defaultValue={invitation.full_name} className={inputClass} />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Instagram *</label>
              <input name="instagram_username" required defaultValue={invitation.instagram_username} className={inputClass} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">City</label>
                <select name="city" defaultValue={meta?.city || ""} className={`${inputClass} appearance-none`}>
                  <option value="">Select a city</option>
                  {INDIAN_CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Gender</label>
                <select name="gender" defaultValue={meta?.gender || ""} className={`${inputClass} appearance-none`}>
                  <option value="">Select gender</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="non_binary">Non-binary</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </div>
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Categories <span className="text-gray-400 font-normal">(comma-separated)</span></label>
            <input name="categories_csv" defaultValue={meta?.categories?.join(", ") || ""} placeholder="e.g. Fashion & Lifestyle, Food & Beverage" className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Languages <span className="text-gray-400 font-normal">(comma-separated)</span></label>
            <input name="languages_csv" defaultValue={meta?.languages?.join(", ") || ""} placeholder="e.g. English, Hindi" className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Tags <span className="text-gray-400 font-normal">(comma-separated)</span></label>
            <input name="tags_csv" defaultValue={meta?.tags?.join(", ") || ""} placeholder="e.g. fitness, vegan, travel" className={inputClass} />
          </div>
          <div>
            <label className="block text-[13px] font-medium text-gray-700 dark:text-gray-300 mb-1.5">Notes</label>
            <input name="notes" defaultValue={text} className={inputClass} />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={loading} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 text-white text-sm font-semibold cursor-pointer">
              {loading && <ButtonSpinner />}{loading ? "Saving..." : "Save"}
            </button>
            <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm cursor-pointer">Cancel</button>
          </div>
        </form>
      </div>
    </>
  );
}
