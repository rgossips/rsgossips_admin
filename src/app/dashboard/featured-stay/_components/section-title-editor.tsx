"use client";

import { SectionTitleEditor } from "@/components/section-title-editor";
import { setStaySectionTitle } from "../actions";

// Binds the shared SectionTitleEditor to the Plan Your Stay save action.

export function StaySectionTitleEditor({ initialTitle, canWrite }: { initialTitle: string; canWrite: boolean }) {
  return (
    <SectionTitleEditor
      initialTitle={initialTitle}
      canWrite={canWrite}
      label="Section title (influencer home)"
      placeholder="Plan your stay with us"
      onSave={setStaySectionTitle}
    />
  );
}
