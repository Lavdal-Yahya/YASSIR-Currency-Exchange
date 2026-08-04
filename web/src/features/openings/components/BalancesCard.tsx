import { useTranslation } from 'react-i18next';
import type { BalanceRow } from '../api/useOpenings';

// One card per currency. Renders code + name + `formatMoney`-style
// figure (currency code beside the amount per architecture §5), the
// weighted-average cost, the last movement date, and a low-balance
// chip when the cached amount is at or below the currency's threshold.

interface Props {
  row: BalanceRow;
}

export function BalancesCard({ row }: Props) {
  const { t, i18n } = useTranslation();
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const isLow =
    row.lowBalanceThreshold !== null &&
    Number.parseFloat(row.cachedAmount) <= Number.parseFloat(row.lowBalanceThreshold);

  return (
    <article className="card-row" aria-label={row.code}>
      <div className="card-row__header">
        <h2 className="card-row__title">{row.code}</h2>
        {isLow ? <span className="badge badge--warn">{t('balances.low')}</span> : null}
      </div>
      <div className="card-row__meta">
        <span className="card-row__mono">
          {row.cachedAmount} {row.code}
        </span>
        <span>{row.name}</span>
      </div>
      <div className="card-row__meta">
        <span>
          {t('balances.avg_cost')}: <strong>{row.cachedAvgMru}</strong> MRU
        </span>
        <span>
          {t('balances.last_movement')}:{' '}
          {row.lastMovementAt ? dateFmt.format(new Date(row.lastMovementAt)) : '—'}
        </span>
      </div>
    </article>
  );
}
