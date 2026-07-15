"use client";

import { BulkInvite } from "@/components/bulk-invite";
import { useTranslations } from "next-intl";
import { bulkInviteBrands } from "./actions";

export function BulkInviteBrands() {
  const t = useTranslations("DashboardBrandsBulkInviteBrands");
  const COLUMNS = [
    { key: "brand_name", label: t("brandName.label"), required: true, example: t("brandName.example"), helper: t("brandName.helper") },
    { key: "instagram_username", label: t("instagramUsername.label"), required: true, example: t("instagramUsername.example"), helper: t("instagramUsername.helper") },
    { key: "category", label: t("category.label"), example: t("category.example"), helper: t("category.helper") },
    { key: "instagram_verified", label: t("instagramVerified.label"), example: t("instagramVerified.example"), helper: t("instagramVerified.helper") },
    { key: "notes", label: t("notes.label"), example: t("notes.example"), helper: t("notes.helper") },
  ];
  return <BulkInvite type="brand" templateColumns={COLUMNS} onSubmit={bulkInviteBrands} />;
}
