"use client";

import { useTranslations } from "next-intl";
import { SectionTitleEditor } from "@/components/section-title-editor";
import { setCreatorStoriesSectionTitle } from "../actions";

// Wires the shared SectionTitleEditor to the creator-stories save action.

export function CreatorStoriesSectionTitleEditor({ initialTitle, canWrite }: { initialTitle: string; canWrite: boolean }) {
  const t = useTranslations("DashboardCreatorStoriesComponentsSectionTitleEditor");
  return (
    <SectionTitleEditor
      initialTitle={initialTitle}
      canWrite={canWrite}
      label={t("label")}
      placeholder={t("placeholder")}
      onSave={setCreatorStoriesSectionTitle}
    />
  );
}
