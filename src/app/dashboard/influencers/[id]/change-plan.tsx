"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateInfluencerPlan } from "../actions";
import { ButtonSpinner } from "@/components/spinner";
import { SUBSCRIPTION_PLANS, PLAN_BADGE_CLASS } from "@/lib/subscription-plans";

export function ChangePlanButton({
  influencerId,
  currentPlan,
}: {
  influencerId: string;
  currentPlan: string | null;
}) {
  const t = useTranslations("DashboardInfluencersIdChangePlan");
  const [open, setOpen] = useState(false);
  const currentLabel = SUBSCRIPTION_PLANS.find((p) => p.key === currentPlan)?.label || t("freeLabel");
  const badgeClass = PLAN_BADGE_CLASS[currentPlan || ""] || "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-semibold cursor-pointer transition-colors"
      >
        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
          {currentLabel}
        </span>
        <span className="text-gray-500 dark:text-gray-400">{t("changePlan")}</span>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>
      {open && <ChangePlanModal influencerId={influencerId} currentPlan={currentPlan} onClose={() => setOpen(false)} />}
    </>
  );
}

function ChangePlanModal({
  influencerId,
  currentPlan,
  onClose,
}: {
  influencerId: string;
  currentPlan: string | null;
  onClose: () => void;
}) {
  const t = useTranslations("DashboardInfluencersIdChangePlan");
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(currentPlan);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!selected || selected === currentPlan) { onClose(); return; }
    setError(""); setLoading(true);
    const result = await updateInfluencerPlan(influencerId, selected);
    if (result.error) { setError(result.error); setLoading(false); }
    else { router.refresh(); onClose(); }
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed z-50 inset-2 lg:inset-auto lg:left-1/2 lg:top-1/2 lg:-translate-x-1/2 lg:-translate-y-1/2 lg:w-full lg:max-w-lg bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div>
            <h2 className="text-base font-bold text-gray-900 dark:text-white">{t("title")}</h2>
            <p className="text-[11px] text-gray-400 mt-0.5">{t("subtitle")}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 cursor-pointer">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-2">
          {error && <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">{error}</div>}

          {SUBSCRIPTION_PLANS.map((plan) => {
            const isSelected = selected === plan.key;
            const isCurrent = currentPlan === plan.key;
            return (
              <button
                key={plan.key}
                type="button"
                onClick={() => setSelected(plan.key)}
                className={`flex items-start gap-3 w-full p-3.5 rounded-xl text-left cursor-pointer transition-all border-2 ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
                    : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                }`}
              >
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors ${
                  isSelected ? "border-indigo-600 bg-indigo-600" : "border-gray-300 dark:border-gray-600"
                }`}>
                  {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${PLAN_BADGE_CLASS[plan.key]}`}>
                      {plan.label}
                    </span>
                    {isCurrent && <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{t("current")}</span>}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{plan.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
          <button
            onClick={handleSave}
            disabled={loading || !selected || selected === currentPlan}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-300 disabled:cursor-not-allowed text-white text-sm font-semibold cursor-pointer transition-colors"
          >
            {loading && <ButtonSpinner />}
            {loading ? t("saving") : t("savePlan")}
          </button>
          <button onClick={onClose} className="px-5 py-2.5 rounded-xl bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 text-sm font-medium cursor-pointer">
            {t("cancel")}
          </button>
        </div>
      </div>
    </>
  );
}
