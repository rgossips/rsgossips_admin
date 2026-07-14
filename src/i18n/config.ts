// i18n config — CLIENT-SAFE constants only (no next/headers here).
//
// English is the source of truth. To add a language:
//   1. Add its code + display name below.
//   2. Create messages/<code>.json (copy en.json and translate the values).

export const locales = ["en"] as const;
export type AppLocale = (typeof locales)[number];
export const defaultLocale: AppLocale = "en";

export const localeNames: Record<string, string> = {
  en: "English",
};
