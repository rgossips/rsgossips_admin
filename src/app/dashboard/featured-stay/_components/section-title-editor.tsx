"use client";

import { useTranslations } from "next-intl";

import { SectionTitleEditor } from "@/components/section-title-editor";
import { setStaySectionTitle } from "../actions";

// Binds the shared SectionTitleEditor to the Plan Your Stay save action.

export function StaySectionTitleEditor({ initialTitle, canWrite }: { initialTitle: string; canWrite: boolean }) {
  const t = useTranslations("DashboardFeaturedStayComponentsSectionTitleEditor");
  return (
    <SectionTitleEditor
      initialTitle={initialTitle}
      canWrite={canWrite}
      label={t("label")}
      placeholder={t("placeholder")}
      onSave={setStaySectionTitle}
    />
  );
}
