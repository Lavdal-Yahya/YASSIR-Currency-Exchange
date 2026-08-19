import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SideBySideDebtsPanel } from '../../debts/components/SideBySideDebtsPanel';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useBalances } from '../../openings/api/useOpenings';
import { request } from '../../../shared/api/client';
import {
  useContactTrades,
  type ContactTradeItem,
  type PaginatedResponse,
} from '../../trades/api/useTrades';
import {
  useArchiveContact,
  useContact,
  useUnarchiveContact,
  useUpdateContact,
  type Contact,
} from '../api/useContacts';
import { ContactForm } from '../components/ContactForm';

type Tab = 'overview' | 'debts' | 'trades';

const TAB_ORDER: Tab[] = ['overview', 'debts', 'trades'];

const PAGE_STEP = 20;

export function ContactProfilePage() {
  const { t } = useTranslation();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const q = useContact(id);
  const update = useUpdateContact(id);
  const archive = useArchiveContact(id);
  const unarchive = useUnarchiveContact(id);
  const [editing, setEditing] = useState(false);
  // Default to trades tab so clicking a contact shows their history immediately.
  const [tab, setTab] = useState<Tab>('trades');

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data) return <p className="empty-state">{t('contacts.profile.not_found')}</p>;
  const c = q.data;

  if (editing) {
    return (
      <>
        <PageHeader title={t('contacts.edit')} />
        <ContactForm
          initial={c}
          onSubmit={async (input) => {
            await update.mutateAsync(input);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          submitting={update.isPending}
          error={update.error}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={c.name}
        action={
          <button type="button" className="btn btn--secondary" onClick={() => setEditing(true)}>
            {t('common.edit')}
          </button>
        }
      />

      <nav className="tabs" role="tablist" aria-label={t('contacts.title')}>
        {TAB_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-current={tab === key ? 'page' : undefined}
            className="tabs__item"
            onClick={() => setTab(key)}
          >
            {t(`contacts.profile.${key}`)}
          </button>
        ))}
      </nav>

      <div role="tabpanel">
        {tab === 'overview' ? <OverviewPanel contact={c} /> : null}
        {tab === 'debts' ? <SideBySideDebtsPanel contactId={id} /> : null}
        {tab === 'trades' ? <ContactTradesTab contactId={id} contactName={c.name} /> : null}
      </div>

      <div className="profile-actions">
        {c.isArchived ? (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => unarchive.mutate()}
            disabled={unarchive.isPending}
          >
            {t('contacts.unarchive')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--danger"
            onClick={async () => {
              await archive.mutateAsync();
              navigate('/contacts');
            }}
            disabled={archive.isPending}
          >
            {t('contacts.archive')}
          </button>
        )}
      </div>
    </>
  );
}

function ContactTradesTab({ contactId, contactName }: { contactId: string; contactName: string }) {
  const { t, i18n } = useTranslation();
  const [limit, setLimit] = useState(PAGE_STEP);
  const [exporting, setExporting] = useState(false);
  const q = useContactTrades(contactId, limit);
  // Build a UUID → currency code lookup from balances
  const balances = useBalances();
  const currencyCode = (id: string) =>
    balances.data?.find((b) => b.currencyId === id)?.code ?? id.slice(0, 3);

  async function handleExport() {
    // Open immediately so browsers don't treat it as a popup.
    const win = window.open('', '_blank');
    if (!win) return;
    setExporting(true);
    try {
      const all = await request<PaginatedResponse<ContactTradeItem>>(
        `/contacts/${contactId}/trades?limit=10000&offset=0`,
      );

      const dir = i18n.dir();
      const isRtl = dir === 'rtl';
      const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });
      const exportedOn = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'long' }).format(
        new Date(),
      );

      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      const rows = all.data
        .map((item) => {
          const isIn = item.kind === 'purchase';
          const delivCode = currencyCode(item.deliveredCurrencyId);
          const payCode = currencyCode(item.paymentCurrencyId);
          const payStatus =
            item.kind === 'purchase'
              ? t(`purchases.payment_status.${item.paymentStatus}`)
              : t(`sales.payment_status.${item.paymentStatus}`);
          return `<tr>
            <td class="mono">${esc(dateFmt.format(new Date(item.transactionDate)))}</td>
            <td class="${isIn ? 'in' : 'out'}">${esc(isIn ? t('purchases.title') : t('sales.title'))}</td>
            <td class="mono r">${esc(parseFloat(item.deliveredAmount).toFixed(2))} ${esc(delivCode)}</td>
            <td class="mono r">${esc(parseFloat(item.rate).toFixed(4))}</td>
            <td class="mono r">${esc(parseFloat(item.paymentTotal).toFixed(2))} ${esc(payCode)}</td>
            <td class="mono r">${esc(parseFloat(item.outstandingAmount).toFixed(2))} ${esc(payCode)}</td>
            <td class="${payStatusClass(item.paymentStatus)}">${esc(payStatus)}</td>
            <td>${esc(item.reference ?? '')}</td>
          </tr>`;
        })
        .join('');

      const html = `<!DOCTYPE html>
<html lang="${i18n.language}" dir="${dir}">
<head>
<meta charset="UTF-8">
<title>${esc(contactName)}</title>
<style>
*{box-sizing:border-box}
body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#111;margin:0;padding:24px}
h1{font-size:18px;font-weight:700;margin:0 0 2px}
.sub{font-size:11px;color:#777;margin:0 0 20px}
table{width:100%;border-collapse:collapse}
th{background:#111;color:#fff;text-align:start;padding:6px 8px;font-size:10px;
   text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
td{padding:5px 8px;border-bottom:1px solid #e8e8e8;vertical-align:middle;white-space:nowrap}
tr:nth-child(even) td{background:#f7f7f7}
.mono{font-family:'Courier New',monospace}
.r{text-align:end}
.in{color:#0a7c42}
.out{color:#c2410c}
.warn{color:#b45309}
.danger{color:#c2410c}
@media print{
  @page{margin:12mm 15mm;size:A4 landscape}
  body{padding:0}
  button{display:none}
}
</style>
</head>
<body>
<h1>${esc(contactName)}</h1>
<p class="sub">${esc(exportedOn)}</p>
<table>
<thead><tr>
  <th>${esc(t('purchases.date'))}</th>
  <th>Type</th>
  <th>${esc(t('purchases.delivered_amount'))}</th>
  <th>${esc(t('purchases.rate_label'))}</th>
  <th>${esc(t('purchases.payment_total'))}</th>
  <th>${esc(t('purchases.outstanding'))}</th>
  <th>${esc(t('contacts.profile.pdf_pay_status'))}</th>
  <th>${esc(t('purchases.reference'))}</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
<script>window.onload=function(){window.print()}</script>
</body>
</html>`;

      win.document.open();
      win.document.write(html);
      win.document.close();
    } catch {
      win.close();
    } finally {
      setExporting(false);
    }
  }

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data || q.data.data.length === 0) {
    return <p className="empty-state">{t('contacts.profile.trades_empty')}</p>;
  }

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBlockEnd: 'var(--sp-3)' }}>
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={handleExport}
          disabled={exporting}
        >
          {exporting ? t('common.loading') : t('contacts.profile.export_pdf')}
        </button>
      </div>

      <ul className="card-list" aria-label={t('contacts.profile.trades')}>
        {q.data.data.map((item) => {
          const path = item.kind === 'purchase' ? `/purchases/${item.id}` : `/sales/${item.id}`;
          const isIn = item.kind === 'purchase';
          const badge = isIn ? t('purchases.title') : t('sales.title');
          return (
            <li key={`${item.kind}-${item.id}`}>
              <Link to={path} className="card-row">
                <div className="card-row__header">
                  <h3 className="card-row__title">
                    <span style={{ color: isIn ? 'var(--in-text)' : 'var(--out-text)' }}>
                      {isIn ? '↓' : '↑'}
                    </span>{' '}
                    {item.deliveredAmount}{' '}
                    <span className="card-row__currency">
                      {currencyCode(item.deliveredCurrencyId)}
                    </span>
                  </h3>
                  <span className={`badge ${isIn ? 'badge--in' : 'badge--out'}`}>{badge}</span>
                </div>
                <div className="card-row__meta">
                  <span className="card-row__mono">
                    {dateFmt.format(new Date(item.transactionDate))}
                  </span>
                  <span className={`badge badge--${payStatusClass(item.paymentStatus)}`}>
                    {item.kind === 'purchase'
                      ? t(`purchases.payment_status.${item.paymentStatus}`)
                      : t(`sales.payment_status.${item.paymentStatus}`)}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {q.data.total > limit ? (
        <div style={{ textAlign: 'center', marginBlockStart: 'var(--sp-4)' }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => setLimit((l) => l + PAGE_STEP)}
            disabled={q.isFetching}
          >
            {q.isFetching ? t('common.loading') : t('contacts.profile.see_more')}
          </button>
        </div>
      ) : null}
    </>
  );
}

function payStatusClass(status: string) {
  if (status === 'PAID') return 'in';
  if (status === 'PARTIALLY_PAID') return 'warn';
  return 'danger';
}

function OverviewPanel({ contact: c }: { contact: Contact }) {
  const { t } = useTranslation();
  return (
    <div className="card-row">
      <div className="card-row__meta">
        {c.phone ? <span className="card-row__mono">{c.phone}</span> : null}
        {c.isCustomer ? <span className="badge badge--in">{t('contacts.is_customer')}</span> : null}
        {c.isSupplier ? (
          <span className="badge badge--out">{t('contacts.is_supplier')}</span>
        ) : null}
        {c.isArchived ? (
          <span className="badge badge--danger">{t('contacts.archived_badge')}</span>
        ) : null}
      </div>
      {c.notes ? <p>{c.notes}</p> : null}
      <p className="card-row__mono">
        {t('contacts.profile.created_at')}: {new Date(c.createdAt).toLocaleString()}
      </p>
    </div>
  );
}
