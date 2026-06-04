"use client";

import { DeleteUserModal } from "@/components/delete-user-modal";
import { deleteBrandStep } from "../delete-actions";
import { BRAND_DELETE_STEPS } from "../delete-steps";

export function DeleteBrandButton({
  brandId,
  displayName,
  confirmText,
}: {
  brandId: string;
  displayName: string;
  confirmText: string;
}) {
  return (
    <DeleteUserModal
      kind="brand"
      targetId={brandId}
      displayName={displayName}
      confirmText={confirmText}
      steps={BRAND_DELETE_STEPS.map((s) => ({ key: s.key, label: s.label }))}
      runStep={(id, key) => deleteBrandStep(id, key as never)}
      redirectTo="/dashboard/brands"
    />
  );
}
