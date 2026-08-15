import { useTranslation } from 'react-i18next';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { useAgeingReport, type AgeingBucket, type AgeingSection } from '../api/useReports';

// Ageing report page (P7-06). Aggregated counts + per-currency totals per
// bucket. No cross-currency addition — each currency renders as its own
// row within the bucket.

const BUCKETS: Array<{ key: keyof AgeingSection; i18n: string }> = [
  { key: 'current', i18n: 'reports.bucket_current' },
  { key: 'bucket31to60', i18n: 'reports.bucket_31_60' },
  { key: 'bucket61to90', i18n: 'reports.bucket_61_90' },
  { key: 'bucket91plus', i18n: 'reports.bucket_91_plus' },
];

export function AgeingReportPage() {
  const { t } = useTranslation();
  const q = useAgeingReport();

  const csvUrl = `/api/v1/reports/ageing?format=csv`;

  return (
    <>
      <PageHeader
        title={t('reports.ageing_title')}
        action={
          <a className="btn btn--ghost" href={csvUrl} download>
            {t('common.download_csv')}
          </a>
        }
      />

      {q.isLoading ? <Loading /> : null}
      {q.error ? <ErrorMessage error={q.error} /> : null}
      {q.data ? (
        <>
          <h2>{t('reports.receivables_ageing')}</h2>
          <AgeingTable section={q.data.receivables} />
          <h2>{t('reports.payables_ageing')}</h2>
          <AgeingTable section={q.data.payables} />
        </>
      ) : null}
    </>
  );
}

function AgeingTable({ section }: { section: AgeingSection }) {
  const { t } = useTranslation();
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>{t('reports.bucket')}</th>
            <th>{t('reports.count')}</th>
            <th>{t('reports.currency')}</th>
            <th>{t('reports.total')}</th>
          </tr>
        </thead>
        <tbody>
          {BUCKETS.flatMap(({ key, i18n }) => {
            const bucket: AgeingBucket = section[key];
            if (bucket.count === 0) {
              return [
                <tr key={key}>
                  <td>{t(i18n)}</td>
                  <td>0</td>
                  <td>—</td>
                  <td>—</td>
                </tr>,
              ];
            }
            return bucket.byCurrency.map((cur, idx) => (
              <tr key={`${key}-${cur.currencyCode}`}>
                {idx === 0 ? <td rowSpan={bucket.byCurrency.length}>{t(i18n)}</td> : null}
                {idx === 0 ? <td rowSpan={bucket.byCurrency.length}>{bucket.count}</td> : null}
                <td>{cur.currencyCode}</td>
                <td>{cur.total}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}
