import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useAuditLog, type AuditFilters, type AuditLogRow } from '../api/useAudit';

// Operational history feed — owner only.
// Login/logout events are hidden; what remains is a timeline of
// financial and administrative operations, styled like a banking app.

const PAGE_SIZE = 30;

// Connection events are noise in a transaction history view.
const HIDDEN_ACTIONS = new Set(['login_succeeded', 'login_failed', 'logout']);

function actionStyle(action: string): { icon: string; colorClass: string } {
  if (action === 'purchase_created') return { icon: '↓', colorClass: 'history-icon--in' };
  if (action === 'sale_created') return { icon: '↑', colorClass: 'history-icon--out' };
  if (action === 'payment_created') return { icon: '⇌', colorClass: 'history-icon--in' };
  if (action === 'expense_created') return { icon: '−', colorClass: 'history-icon--out' };
  if (action === 'opening_balance_created')
    return { icon: '○', colorClass: 'history-icon--neutral' };
  if (action.endsWith('_reversed')) return { icon: '↩', colorClass: 'history-icon--danger' };
  return { icon: '·', colorClass: 'history-icon--neutral' };
}

function groupLabel(dateStr: string, lang: string, t: (k: string) => string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('common.today');
  if (d.toDateString() === yesterday.toDateString()) return t('common.yesterday');
  return new Intl.DateTimeFormat(lang, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(d);
}

function formatTime(dateStr: string, lang: string) {
  return new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(dateStr),
  );
}

export function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const [offset, setOffset] = useState(0);

  const filters = useMemo<AuditFilters>(() => ({ limit: PAGE_SIZE, offset }), [offset]);
  const q = useAuditLog(filters);

  const visible = useMemo(
    () => (q.data?.data ?? []).filter((r) => !HIDDEN_ACTIONS.has(r.action)),
    [q.data],
  );

  // Group by calendar day
  type Group = { label: string; rows: AuditLogRow[] };
  const groups = useMemo<Group[]>(() => {
    const result: Group[] = [];
    // Hold the open group rather than re-reading `result.at(-1)` — the
    // array access is never actually undefined here, but proving that to
    // the compiler needed a non-null assertion, which conventions §2 bans.
    let current: Group | null = null;
    for (const row of visible) {
      const label = groupLabel(row.createdAt, i18n.language, t);
      if (!current || current.label !== label) {
        current = { label, rows: [] };
        result.push(current);
      }
      current.rows.push(row);
    }
    return result;
  }, [visible, i18n.language, t]);

  return (
    <>
      <PageHeader title={t('audit.page_title')} />

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}

      {q.data && visible.length === 0 ? <p className="empty-state">{t('audit.no_data')}</p> : null}

      {groups.map((group) => (
        <section key={group.label} className="history-group">
          <h2 className="history-group__date">{group.label}</h2>
          <ul className="card-list">
            {group.rows.map((r) => {
              const { icon, colorClass } = actionStyle(r.action);
              return (
                <li key={r.id}>
                  <div className="history-entry">
                    <span className={`history-entry__icon ${colorClass}`} aria-hidden="true">
                      {icon}
                    </span>
                    <div className="history-entry__body">
                      <p className="history-entry__desc">
                        {t(`audit.actions.${r.action}`, { defaultValue: r.action })}
                      </p>
                      <p className="history-entry__meta">
                        {r.actorName ?? r.actorPhone ?? t('audit.unknown_actor')}
                        {' · '}
                        {formatTime(r.createdAt, i18n.language)}
                      </p>
                      {r.reason ? (
                        <p className="history-entry__reason">
                          {t('audit.reason')}: {r.reason}
                        </p>
                      ) : null}
                    </div>
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
