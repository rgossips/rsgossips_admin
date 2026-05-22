"use client";

import { BulkInvite } from "@/components/bulk-invite";
import { bulkInviteBrands } from "./actions";

const COLUMNS = [
  { key: "brand_name", label: "Brand Name", required: true, example: "Nike India", helper: "Required" },
  { key: "instagram_username", label: "Instagram Username", required: true, example: "nikeindia", helper: "Required (without @)" },
  { key: "category", label: "Category", example: "Fashion & Lifestyle", helper: "Optional" },
  { key: "instagram_verified", label: "Instagram Verified", example: "yes", helper: "Optional (yes/no)" },
  { key: "notes", label: "Notes", example: "Partnership contact: john@nike.com", helper: "Optional" },
];

export function BulkInviteBrands() {
  return <BulkInvite type="brand" templateColumns={COLUMNS} onSubmit={bulkInviteBrands} />;
}
