import { useTranslation } from 'react-i18next';
import { useOnline } from './useOnline';

// Persistent banner that PUSHES CONTENT DOWN rather than covering it
// (design handoff "Offline state" rule). Banner-only in P1 — the
// write-blocking (disabling every mutating form) arrives with the
// first mutating form in P4 (phase-1.md §8).

export function OfflineBanner() {
  const { t } = useTranslation();
  const online = useOnline();
  if (online) return null;
  return (
    <div className="offline-banner" role="status" aria-live="polite">
      {t('errors.network')}
    </div>
  );
}
