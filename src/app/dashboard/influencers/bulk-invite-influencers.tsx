"use client";

import { BulkInvite } from "@/components/bulk-invite";
import { useTranslations } from "next-intl";
import { bulkInviteInfluencers } from "./actions";

export function BulkInviteInfluencers() {
  const t = useTranslations("DashboardInfluencersBulkInviteInfluencers");
  const COLUMNS = [
    { key: "full_name", label: t("fullName.label"), required: true, example: t("fullName.example"), helper: t("fullName.helper") },
    { key: "instagram_username", label: t("instagramUsername.label"), required: true, example: t("instagramUsername.example"), helper: t("instagramUsername.helper") },
    { key: "city", label: t("city.label"), required: true, example: t("city.example"), helper: t("city.helper") },
    { key: "gender", label: t("gender.label"), example: t("gender.example"), helper: t("gender.helper") },
    { key: "categories", label: t("categories.label"), example: t("categories.example"), helper: t("categories.helper") },
    { key: "languages", label: t("languages.label"), example: t("languages.example"), helper: t("languages.helper") },
    { key: "tags", label: t("tags.label"), example: t("tags.example"), helper: t("tags.helper") },
    { key: "notes", label: t("notes.label"), example: t("notes.example"), helper: t("notes.helper") },
  ];
  return <BulkInvite type="influencer" templateColumns={COLUMNS} onSubmit={bulkInviteInfluencers} />;
}
