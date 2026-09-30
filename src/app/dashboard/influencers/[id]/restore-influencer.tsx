"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ConfirmDialog, useConfirmDialog } from "@/components/confirm-dialog";
import { restoreInfluencerAccount } from "../actions";

// Undo a creator's own "delete my account" inside the 30-day grace window.
// Rendered only for a pending_deletion row, and only for a super admin — see
// restoreInfluencerAccount() for why the gate sits there.
export function RestoreInfluencerButton({
  influencerId,
  displayName,
}: {
  influencerId: string;
  displayName: string;
}) {
  const t = useTranslations("DashboardInfluencersId.restore");
  const router = useRouter();
  const { ask, dialogProps } = useConfirmDialog();
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const run = () =>
    ask({
      title: t("confirmTitle"),
      description: t("confirmBody", { name: displayName }),
      confirmLabel: t("confirmAction"),
      variant: "primary",
      handler: async () => {
        setError("");
        setNote("");
        const res = await restoreInfluencerAccount(influencerId);
        if (res.error) {
          setError(res.error);
          return;
        }
        // The creator is told by email when we have one — say which happened,
        // because "restored but they don't know" is a different situation for
        // whoever is handling the request.
        setNote(res.emailSent ? t("doneEmailed") : res.emailError ? t("doneEmailFailed") : t("doneNoEmail"));
        router.refresh();
      },
    });

  return (
    <>
      <button
        type="button"
        onClick={run}
        className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-3.5 text-[13px] font-semibold text-white hover:bg-emerald-500 cursor-pointer"
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 14l-4-4 4-4m-4 4h9a5 5 0 110 10h-3" />
        </svg>
        {t("button")}
      </button>

      {(error || note) && (
        <p className={`mt-2 text-[12px] ${error ? "text-rose-600 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
          {error || note}
        </p>
      )}

      <ConfirmDialog {...dialogProps} />
    </>
  );
}
