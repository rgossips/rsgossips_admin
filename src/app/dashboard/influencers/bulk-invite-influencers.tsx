"use client";

import { BulkInvite } from "@/components/bulk-invite";
import { bulkInviteInfluencers } from "./actions";

const COLUMNS = [
  { key: "full_name", label: "Full Name", required: true, example: "Priya Sharma", helper: "Required" },
  { key: "instagram_username", label: "Instagram Username", required: true, example: "priyasharma", helper: "Required (without @)" },
  { key: "city", label: "City", required: true, example: "Mumbai", helper: "Required" },
  { key: "gender", label: "Gender", required: true, example: "female", helper: "Required (female/male/non_binary/prefer_not_to_say)" },
  { key: "categories", label: "Categories", example: "Fashion & Lifestyle; Beauty & Skincare", helper: "Optional (semicolon-separated)" },
  { key: "languages", label: "Languages", example: "English; Hindi", helper: "Optional (semicolon-separated)" },
  { key: "tags", label: "Tags", example: "fitness; vegan", helper: "Optional (semicolon-separated)" },
  { key: "notes", label: "Notes", example: "Met at fashion week", helper: "Optional" },
];

export function BulkInviteInfluencers() {
  return <BulkInvite type="influencer" templateColumns={COLUMNS} onSubmit={bulkInviteInfluencers} />;
}
