import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import { locales, defaultLocale } from "./config";

// "Without i18n routing" — locale in a NEXT_LOCALE cookie, no URL prefix, so
// the existing /dashboard/* routes are untouched. LanguageSwitcher writes the
// cookie; this resolves the same locale + messages for Server and Client
// Components on every request.
export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get("NEXT_LOCALE")?.value ?? "";
  const locale = (locales as readonly string[]).includes(cookieLocale)
    ? cookieLocale
    : defaultLocale;

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
