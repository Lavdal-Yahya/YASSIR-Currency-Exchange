import { useTranslation } from 'react-i18next';
import { setLanguage, SUPPORTED_LANGUAGES, type Language } from './i18n';

// Segmented control — one button per supported language. `aria-pressed`
// carries the active state so screen readers understand it's a switch
// rather than plain navigation.
//
// `compact` is the title-bar chip (design handoff: bordered chip, mono,
// `FR ع`). The full-size variant stays on the profile screen.

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const active = i18n.language as Language;

  return (
    <div
      role="group"
      aria-label={t('profile.language')}
      className={`language-switcher${compact ? ' language-switcher--compact' : ''}`}
    >
      {SUPPORTED_LANGUAGES.map((lang) => (
        <button
          type="button"
          key={lang}
          aria-pressed={active === lang}
          className={`language-switcher__item${active === lang ? ' is-active' : ''}`}
          onClick={() => setLanguage(lang)}
        >
          {t(`profile.language_${lang}`)}
        </button>
      ))}
    </div>
  );
}
