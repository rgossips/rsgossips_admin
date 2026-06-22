"use client";

import { SectionTitleEditor } from "@/components/section-title-editor";
import { setCreatorStoriesSectionTitle } from "../actions";

// Wires the shared SectionTitleEditor to the creator-stories save action.

export function CreatorStoriesSectionTitleEditor({ initialTitle, canWrite }: { initialTitle: string; canWrite: boolean }) {
  return (
    <SectionTitleEditor
      initialTitle={initialTitle}
      canWrite={canWrite}
      label="Section title (marketing home)"
      placeholder="TOP CREATOR STORIES"
      onSave={setCreatorStoriesSectionTitle}
    />
  );
}
