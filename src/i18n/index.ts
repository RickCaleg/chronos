import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";

export const SUPPORTED_LANGUAGES = ["en", "pt-BR"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      "pt-BR": { translation: ptBR },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "chronos.language",
      caches: ["localStorage"],
    },
    interpolation: { escapeValue: false },
  });

export default i18n;
