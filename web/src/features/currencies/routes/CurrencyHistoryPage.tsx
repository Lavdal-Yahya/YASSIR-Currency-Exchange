import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParams } from 'react-router-dom';
import { useBalances } from '../../openings/api/useOpenings';
import { useCurrencyLedger } from '../api/useLedger';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';

const PAGE_SIZE = 30;

function fmt1(s: string) {
  return parseFloat(s).toFixed(1);
}

function formatTime(dateStr: string, lang: string) {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(dateStr),
  );
}

function groupLabel(dateStr: string, lang: string, t: (k: string) => string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('common.today');
  if (d.toDateString() === yesterday.toDateString()) return t('common.yesterday');
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(
    d,
  );
}

export function CurrencyHistoryPage() {
  const { t, i18n } = useTranslation();
  const { id = '' } = useParams();
  const [offset, setOffset] = useState(0);

  const balances = useBalances();
  const q = useCurrencyLedger(id, PAGE_SIZE, offset);

  const currency = balances.data?.find((b) => b.currencyId === id);

  // Group entries by day
  type Group = { label: string; entries: NonNullable<typeof q.data>['rows'] };
  const groups: Group[] = [];
  if (q.data) {
    let currentLabel = '';
    for (const entry of q.data.rows) {
      const label = groupLabel(entry.transactionDate as string, i18n.language, t);
      if (label !== currentLabel) {
        groups.push({ label, entries: [] });
        currentLabel = label;
      }
      groups.at(-1)!.entries.push(entry);
    }
  }

  return (
    <>
      <PageHeader
        title={currency ? `${currency.code} — ${t('currencies.history')}` : t('currencies.history')}
      />

      {currency ? (
        <div className="currency-balance-hero">
          <span className="currency-balance-hero__amount">
            {fmt1(currency.cachedAmount)} {currency.code}
          </span>
          <span className="currency-balance-hero__label">{t('balances.title')}</span>
        </div>
      ) : null}

      {q.isLoading || balances.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}

      {q.data && q.data.rows.length === 0 ? (
        <p className="empty-state">{t('currencies.ledger_empty')}</p>
      ) : null}

      {groups.map((group) => (
        <section key={group.label} className="history-group">
          <h2 className="history-group__date">{group.label}</h2>
          <ul className="card-list">
            {group.entries.map((entry) => {
              const isIn = entry.direction === 'CREDIT';
              return (
                <li key={entry.id}>
                  <div className="history-entry">
                    <span
                      className={`history-entry__icon ${isIn ? 'history-entry__icon--in' : 'history-entry__icon--out'}`}
                      aria-hidden="true"
                    >
                      {isIn ? '↓' : '↑'}
                    </span>
                    <div className="history-entry__body">
                      <p className="history-entry__desc">{entry.description}</p>
                      <p className="history-entry__meta">
                        {formatTime(entry.transactionDate as string, i18n.language)}
                        {' · '}
                        <span className="history-entry__source">{entry.sourceType}</span>
                      </p>
                    </div>
                    <p
                      className={`history-entry__amount ${isIn ? 'history-entry__amount--in' : 'history-entry__amount--out'}`}
                    >
                      {isIn ? '+' : '−'}
                      {fmt1(entry.amount)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {q.data && q.data.total > PAGE_SIZE ? (
        <div className="pagination">
          <button
            type="button"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          >
            {t('common.prev_page')}
          </button>
          <span>
            {offset + 1}–{Math.min(offset + PAGE_SIZE, q.data.total)} / {q.data.total}
          </span>
          <button
            type="button"
            disabled={offset + PAGE_SIZE >= q.data.total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            {t('common.next_page')}
          </button>
        </div>
      ) : null}
    </>
  );
}
