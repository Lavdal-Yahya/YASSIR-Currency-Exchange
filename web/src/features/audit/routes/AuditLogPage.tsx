import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useAuditLog, type AuditFilters, type AuditLogRow } from '../api/useAudit';

// Audit log viewer — owner only. Server enforces AUDIT_READ; the UI is a
// courtesy. Filters: entity type, actor, action, date range. Diff view
// shows before/after as pretty JSON — the audit rows only carry deltas
// (audit.service.ts docstring), so the diff stays small.

const PAGE_SIZE = 25;

export function AuditLogPage() {
  const { t } = useTranslation();
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);

  const filters = useMemo<AuditFilters>(
    () => ({
      ...(entityType ? { entityType } : {}),
      ...(action ? { action } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    [entityType, action, offset],
  );
  const q = useAuditLog(filters);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <>
      <PageHeader title={t('audit.page_title')} />

      <form className="filter-bar" onSubmit={(e) => e.preventDefault()}>
        <label>
          <span>{t('audit.entity_type')}</span>
          <input
            type="text"
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setOffset(0);
            }}
            placeholder="sale, purchase, payment, expense…"
          />
        </label>
        <label>
          <span>{t('audit.action')}</span>
          <input
            type="text"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setOffset(0);
            }}
            placeholder="sale_reversed, purchase_created…"
          />
        </label>
      </form>

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data ? (
        <>
          <table className="data-table">
            <thead>
              <tr>
                <th>{t('audit.when')}</th>
                <th>{t('audit.actor')}</th>
                <th>{t('audit.action')}</th>
                <th>{t('audit.entity')}</th>
                <th>{t('audit.reason')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.data.map((r) => (
                <RowWithDiff
                  key={r.id}
                  r={r}
                  expanded={expanded === r.id}
                  toggle={() => setExpanded((cur) => (cur === r.id ? null : r.id))}
                />
              ))}
              {q.data.data.length === 0 ? (
                <tr>
                  <td colSpan={6}>{t('audit.no_data')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
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
        </>
      ) : null}
    </>
  );
}

function RowWithDiff({
  r,
  expanded,
  toggle,
}: {
  r: AuditLogRow;
  expanded: boolean;
  toggle: () => void;
}) {
  const { t } = useTranslation();
  return (
    <>
      <tr>
        <td>{new Date(r.createdAt).toLocaleString()}</td>
        <td>{r.actorName ?? r.actorPhone ?? '—'}</td>
        <td>{r.action}</td>
        <td>
          {r.entityType}
          {r.entityId ? `#${r.entityId.slice(0, 8)}` : ''}
        </td>
        <td>{r.reason ?? '—'}</td>
        <td>
          {r.before !== null || r.after !== null ? (
            <button type="button" onClick={toggle}>
              {expanded ? t('audit.hide_diff') : t('audit.show_diff')}
            </button>
          ) : null}
        </td>
      </tr>
      {expanded ? (
        <tr>
          <td colSpan={6}>
            <div className="audit-diff">
              <div>
                <h4>{t('audit.before')}</h4>
                <pre>{JSON.stringify(r.before ?? {}, null, 2)}</pre>
              </div>
              <div>
                <h4>{t('audit.after')}</h4>
                <pre>{JSON.stringify(r.after ?? {}, null, 2)}</pre>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}
