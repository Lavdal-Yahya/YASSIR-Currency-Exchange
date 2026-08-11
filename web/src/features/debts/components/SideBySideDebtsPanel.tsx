import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { useCurrencies } from '../../currencies/api/useCurrencies';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { usePayables, useReceivables, type Payable, type Receivable } from '../api/useDebts';

// Side-by-side receivables and payables for a contact who might be both.
// The visible note (not a tooltip) explains the columns are NEVER netted
// — spec §17 forbids netting because it hides who owes what.
// phase-5.md §5 calls this out explicitly: the temptation to "just add a
// net figure" is what this note prevents.
export function SideBySideDebtsPanel({ contactId }: { contactId: string }) {
  const { t } = useTranslation();
  const receivables = useReceivables({ contactId, status: 'OPEN', limit: 100 });
  const payables = usePayables({ contactId, status: 'OPEN', limit: 100 });
  const currencies = useCurrencies();

  if (receivables.isLoading || payables.isLoading) return <Loading />;
  if (receivables.error) return <ErrorMessage error={receivables.error} />;
  if (payables.error) return <ErrorMessage error={payables.error} />;

  const openReceivables = receivables.data?.data.filter((r) => r.paymentStatus !== 'PAID') ?? [];
  const openPayables = payables.data?.data.filter((p) => p.paymentStatus !== 'PAID') ?? [];

  function currCode(currencyId: string): string {
    return currencies.data?.find((c) => c.id === currencyId)?.code ?? currencyId.slice(0, 3);
  }

  return (
    <div className="debts-panel">
      <p className="debts-panel__note" role="note">
        <strong>{t('debts.unnetted_title')}</strong> {t('debts.unnetted_body')}
      </p>

      <div className="debts-panel__grid">
        <section aria-label={t('debts.tab_receivables')} className="debts-panel__col">
          <h3 className="debts-panel__col-title">{t('debts.receivables_owed_to_us')}</h3>
          {openReceivables.length === 0 ? (
            <p className="empty-state">{t('debts.receivables_empty')}</p>
          ) : (
            <ul className="card-list">
              {openReceivables.map((r) => (
                <li key={r.id}>
                  <Link to={`/debts/receivables/${r.id}/receive`} className="card-row">
                    <div className="card-row__header">
                      <h4 className="card-row__title">
                        {r.outstandingAmount}{' '}
                        <span className="card-row__currency">{currCode(r.currencyId)}</span>
                      </h4>
                    </div>
                    <div className="card-row__meta">
                      <span className="card-row__mono">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                      <span className={`badge badge--${payStatusClass(r.paymentStatus)}`}>
                        {t(`debts.payment_status.${r.paymentStatus}`)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <TotalsByCurrency rows={openReceivables} currCode={currCode} t={t} />
        </section>

        <section aria-label={t('debts.tab_payables')} className="debts-panel__col">
          <h3 className="debts-panel__col-title">{t('debts.payables_owed_by_us')}</h3>
          {openPayables.length === 0 ? (
            <p className="empty-state">{t('debts.payables_empty')}</p>
          ) : (
            <ul className="card-list">
              {openPayables.map((p) => (
                <li key={p.id}>
                  <Link to={`/debts/payables/${p.id}/pay`} className="card-row">
                    <div className="card-row__header">
                      <h4 className="card-row__title">
                        {p.outstandingAmount}{' '}
                        <span className="card-row__currency">{currCode(p.currencyId)}</span>
                      </h4>
                    </div>
                    <div className="card-row__meta">
                      <span className="card-row__mono">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                      <span className={`badge badge--${payStatusClass(p.paymentStatus)}`}>
                        {t(`debts.payment_status.${p.paymentStatus}`)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <TotalsByCurrency rows={openPayables} currCode={currCode} t={t} />
        </section>
      </div>
    </div>
  );
}

// Per-currency subtotals — never a sum across currencies (standing rule
// #6 in tasks.md). One row per currency, plainly labelled.
function TotalsByCurrency({
  rows,
  currCode,
  t,
}: {
  rows: (Receivable | Payable)[];
  currCode: (id: string) => string;
  t: (k: string, o?: Record<string, unknown>) => string;
}) {
  if (rows.length === 0) return null;
  const totals = new Map<string, number>();
  for (const r of rows) {
    const key = r.currencyId;
    // Client-side subtotals are display-only; server truth is the ledger.
    totals.set(key, (totals.get(key) ?? 0) + Number(r.outstandingAmount));
  }
  return (
    <div className="debts-panel__totals">
      <span className="debts-panel__totals-label">{t('debts.total_by_currency')}</span>
      <ul>
        {[...totals.entries()].map(([id, total]) => (
          <li key={id}>
            <strong>{total.toLocaleString()}</strong>{' '}
            <span className="card-row__currency">{currCode(id)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function payStatusClass(status: string) {
  if (status === 'PAID') return 'in';
  if (status === 'PARTIALLY_PAID') return 'warn';
  return 'danger';
}
