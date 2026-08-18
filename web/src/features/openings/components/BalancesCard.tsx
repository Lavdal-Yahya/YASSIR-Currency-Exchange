import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import type { BalanceRow } from '../api/useOpenings';

interface Props {
  row: BalanceRow;
}

function fmt1(s: string) {
  return parseFloat(s).toFixed(1);
}

export function BalancesCard({ row }: Props) {
  const { t, i18n } = useTranslation();
  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
  const isLow =
    row.lowBalanceThreshold !== null &&
    Number.parseFloat(row.cachedAmount) <= Number.parseFloat(row.lowBalanceThreshold);

  return (
    <Link to={`/currencies/${row.currencyId}/history`} className="card-row" aria-label={row.code}>
      <div className="card-row__header">
        <h2 className="card-row__title">{row.code}</h2>
        {isLow ? <span className="badge badge--warn">{t('balances.low')}</span> : null}
      </div>
      <div className="card-row__meta">
        <span className="card-row__mono">
          {fmt1(row.cachedAmount)} {row.code}
        </span>
        <span>{row.name}</span>
      </div>
      <div className="card-row__meta">
        <span>
          {t('balances.avg_cost')}: <strong>{fmt1(row.cachedAvgMru)}</strong> MRU
        </span>
        <span>
          {t('balances.last_movement')}:{' '}
          {row.lastMovementAt ? dateFmt.format(new Date(row.lastMovementAt)) : '—'}
        </span>
      </div>
    </Link>
  );
}
