"use client";

import { useTranslations } from "next-intl";
import { SectionTitleEditor } from "@/components/section-title-editor";
import { setFeaturedSectionTitle } from "../actions";

// Thin wrapper that binds the shared SectionTitleEditor to the
// featured-campaigns save action. Kept under _components/ so the existing
// import path keeps working.

export function FeaturedSectionTitleEditor({ initialTitle, canWrite }: { initialTitle: string; canWrite: boolean }) {
  const t = useTranslations("DashboardFeaturedCampaignsComponentsSectionTitleEditor");
  return (
    <SectionTitleEditor
      initialTitle={initialTitle}
      canWrite={canWrite}
      label={t("label")}
      placeholder={t("placeholder")}
      onSave={setFeaturedSectionTitle}
    />
  );
}

// Back-compat alias for the previous import name.
export { FeaturedSectionTitleEditor as SectionTitleEditor };
