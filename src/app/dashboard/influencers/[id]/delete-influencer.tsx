"use client";

import { DeleteUserModal } from "@/components/delete-user-modal";
import { deleteInfluencerStep } from "../delete-actions";
import { INFLUENCER_DELETE_STEPS } from "../delete-steps";

export function DeleteInfluencerButton({
  influencerId,
  displayName,
  confirmText,
}: {
  influencerId: string;
  displayName: string;
  confirmText: string;
}) {
  return (
    <DeleteUserModal
      kind="influencer"
      targetId={influencerId}
      displayName={displayName}
      confirmText={confirmText}
      steps={INFLUENCER_DELETE_STEPS.map((s) => ({ key: s.key, label: s.label }))}
      // Server actions only accept strings; we cast at the boundary
      runStep={(id, key) => deleteInfluencerStep(id, key as never)}
      redirectTo="/dashboard/influencers"
    />
  );
}
