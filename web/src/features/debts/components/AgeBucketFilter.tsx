import { useTranslation } from 'react-i18next';
import type { AgeBucket } from '../api/useDebts';

// The four buckets from spec §17 / phase-5.md §5. Values match the
// server-side enum in ListDebtsQueryDto. Rendered as a chip strip:
// small enough for one-handed phone use, no <select> to avoid an extra
// tap.

const BUCKETS: AgeBucket[] = ['0-7', '8-30', '31-60', '60+'];

export function AgeBucketFilter({
  value,
  onChange,
}: {
  value: AgeBucket | '';
  onChange: (next: AgeBucket | '') => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="chip-group" role="group" aria-label={t('debts.age_filter')}>
      <button
        type="button"
        className={`chip${value === '' ? ' is-active' : ''}`}
        onClick={() => onChange('')}
      >
        {t('debts.age_all')}
      </button>
      {BUCKETS.map((b) => (
        <button
          key={b}
          type="button"
          className={`chip${value === b ? ' is-active' : ''}`}
          onClick={() => onChange(b)}
        >
          {t(`debts.age.${b}`)}
        </button>
      ))}
    </div>
  );
}
