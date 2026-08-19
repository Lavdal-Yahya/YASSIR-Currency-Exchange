import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { PurchasesListPage } from './PurchasesListPage';
import { SalesListPage } from './SalesListPage';

// The `Opérations` tab.
//
// The design merges the spec's two separate trade lists into one screen
// with a segmented filter — "On a phone that means two near-identical
// screens and a navigation choice the user shouldn't have to make"
// (screens.md §1, a deliberate deviation from spec §45).
//
// This is the first half of that merge: one destination, one segmented
// control, the two existing lists behind it. The design's third segment
// ("All", a single interleaved feed) needs a combined server-side query
// and is deliberately not faked here by merging two paginated responses
// in the browser — that would break the page counts and spec §41.
//
// `/purchases` and `/sales` stay routable so deep links, contact-profile
// links, and post-submit redirects keep working.

type Segment = 'purchases' | 'sales';

export function OperationsPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const segment: Segment = params.get('view') === 'sales' ? 'sales' : 'purchases';

  function select(next: Segment) {
    // `replace` so flipping the segment doesn't stack history entries
    // between the tab and the back chevron.
    setParams(next === 'purchases' ? {} : { view: next }, { replace: true });
  }

  return (
    <>
      <div className="segmented" role="group" aria-label={t('nav.operations')}>
        <button
          type="button"
          className={`segmented__item${segment === 'purchases' ? ' is-active' : ''}`}
          aria-pressed={segment === 'purchases'}
          onClick={() => select('purchases')}
        >
          {t('purchases.title')}
        </button>
        <button
          type="button"
          className={`segmented__item${segment === 'sales' ? ' is-active' : ''}`}
          aria-pressed={segment === 'sales'}
          onClick={() => select('sales')}
        >
          {t('sales.title')}
        </button>
      </div>
      {segment === 'purchases' ? <PurchasesListPage /> : <SalesListPage />}
    </>
  );
}
