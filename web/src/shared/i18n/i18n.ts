import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from './locales/ar.json';
import fr from './locales/fr.json';

// Two languages, both loaded eagerly (~4 KB gzipped combined — not worth
// a lazy loader). The active language is persisted to localStorage so
// the choice survives a reload; `dir` is applied to <html> whenever the
// language changes and once on init.

export const SUPPORTED_LANGUAGES = ['fr', 'ar'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

const LS_KEY = 'ce.lang';

function readInitialLanguage(): Language {
  if (typeof localStorage === 'undefined') return 'fr';
  const stored = localStorage.getItem(LS_KEY);
  if (stored === 'ar' || stored === 'fr') return stored;
  return 'fr';
}

function applyDir(lang: Language) {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

void i18n.use(initReactI18next).init({
  resources: {
    fr: { translation: fr },
    ar: { translation: ar },
  },
  lng: readInitialLanguage(),
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
  returnNull: false,
});

applyDir(i18n.language as Language);
i18n.on('languageChanged', (lang) => {
  if (lang === 'ar' || lang === 'fr') applyDir(lang);
});

export function setLanguage(lang: Language): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LS_KEY, lang);
  }
  void i18n.changeLanguage(lang);
}

export { i18n };
