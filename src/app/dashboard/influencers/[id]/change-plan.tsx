"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { updateInfluencerPlan } from "../actions";
import { ButtonSpinner } from "@/components/spinner";
import {
  SUBSCRIPTION_TIERS,
  BILLING_CYCLES,
  PLAN_BADGE_CLASS,
  PLAN_LABEL,
} from "@/lib/subscription-plans";

// A plan is (tier, cycle) — the consumer app reads BOTH columns, so the
// switcher offers all six combinations rather than three bare tiers.
const optionId = (plan: string, cycle: string) => `${plan}_${cycle}`;

export function ChangePlanButton({
  influencerId,
  currentPlan,
  currentCycle,
}: {
  influencerId: string;
  currentPlan: string | null;
  currentCycle: string | null;
}) {
  const t = useTranslations("DashboardInfluencersIdChangePlan");
  const [open, setOpen] = useState(false);
  const planKey = (currentPlan || "").toLowerCase();
  const currentLabel = PLAN_LABEL[planKey] || t("freeLabel");
  const badgeClass = PLAN_BADGE_CLASS[planKey] || "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";
  const cycleKey = (currentCycle || "").toLowerCase();
  const cycleLabel = cycleKey === "annual" ? t("cycleAnnual") : cycleKey === "monthly" ? t("cycleMonthly") : null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 text-xs font-semibold cursor-pointer transition-colors"
      >
        <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${badgeClass}`}>
          {currentLabel}
        </span>
        {cycleLabel && <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{cycleLabel}</span>}
        <span className="text-gray-500 dark:text-gray-400">{t("changePlan")}</span>
        <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>
      {open && (
        <ChangePlanModal
          influencerId={influencerId}
          currentPlan={planKey}
          currentCycle={cycleKey}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function ChangePlanModal({
  influencerId,
  currentPlan,
  currentCycle,
  onClose,
}: {
  influencerId: string;
  currentPlan: string;
  currentCycle: string;
  onClose: () => void;
}) {
  const t = useTranslations("DashboardInfluencersIdChangePlan");
  const router = useRouter();
  // Legacy rows sit on "trial"/"free" with no cycle — those aren't settable
  // options, so nothing is preselected and the admin must pick one of the six.
  const currentId =
    SUBSCRIPTION_TIERS.some((p) => p.key === currentPlan) && (currentCycle === "monthly" || currentCycle === "annual")
      ? optionId(currentPlan, currentCycle)
      : null;
  const [selected, setSelected] = useState<string | null>(currentId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSave = async () => {
    if (!selected || selected === currentId) { onClose(); return; }
    const [plan, cycle] = selected.split("_");
    setError(""); setLoading(true);
    const result = await updateInfluencerPlan(influencerId, plan, cycle);
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

        <div className="p-5 space-y-3 overflow-y-auto">
          {error && <div className="p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">{error}</div>}

          {!currentId && (
            <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-xs leading-relaxed">
              {t("legacyPlanNotice", { plan: PLAN_LABEL[currentPlan] || t("freeLabel") })}
            </div>
          )}

          {SUBSCRIPTION_TIERS.map((tier) => (
            <div key={tier.key} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3.5">
              <div className="flex items-center gap-2">
                <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${PLAN_BADGE_CLASS[tier.key]}`}>
                  {tier.label}
                </span>
                {currentPlan === tier.key && (
                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">{t("current")}</span>
                )}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">{tier.description}</p>

              <div className="grid grid-cols-2 gap-2 mt-3">
                {BILLING_CYCLES.map((cycle) => {
                  const id = optionId(tier.key, cycle);
                  const isSelected = selected === id;
                  const isCurrent = currentId === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelected(id)}
                      aria-pressed={isSelected}
                      className={`flex items-center gap-2.5 p-2.5 rounded-lg text-left cursor-pointer transition-all border-2 ${
                        isSelected
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20"
                          : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
                        isSelected ? "border-indigo-600 bg-indigo-600" : "border-gray-300 dark:border-gray-600"
                      }`}>
                        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-gray-900 dark:text-white">
                            {cycle === "annual" ? t("cycleAnnual") : t("cycleMonthly")}
                          </span>
                          {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                        </div>
                        <span className="text-[11px] text-gray-500 dark:text-gray-400">{tier.pricing[cycle]}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 dark:border-gray-800 flex gap-3">
          <button
            onClick={handleSave}
            disabled={loading || !selected || selected === currentId}
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
