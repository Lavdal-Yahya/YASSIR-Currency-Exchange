import { useTranslation } from 'react-i18next';

// The three-numbers-not-one invariant. Value, cash, and outstanding are
// ALWAYS rendered as three separate figures with labels (D-003). Any
// refactor that collapses them into a single "amount" breaks the core
// purpose of this system — the bureau de change needs to see all three
// simultaneously to know: what did the transaction total? how much
// actually moved? how much is still owed?

interface Props {
  ns: 'purchases' | 'sales';
  /** Payment total (full trade value in the payment currency). */
  value: string;
  valueCurrencyCode: string;
  /** Immediate payment made at time of trade. */
  cash: string;
  cashCurrencyCode: string;
  /** Remaining amount outstanding. */
  outstanding: string;
  outstandingCurrencyCode: string;
}

export function TradeDetailFigures({
  ns,
  value,
  valueCurrencyCode,
  cash,
  cashCurrencyCode,
  outstanding,
  outstandingCurrencyCode,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="trade-figures">
      <dl className="trade-figures__grid">
        <div className="trade-figures__item">
          <dt className="trade-figures__label">{t(`${ns}.figures.value`)}</dt>
          <dd className="trade-figures__amount">
            {value} <span className="trade-figures__currency">{valueCurrencyCode}</span>
          </dd>
        </div>
        <div className="trade-figures__item">
          <dt className="trade-figures__label">{t(`${ns}.figures.cash`)}</dt>
          <dd className="trade-figures__amount">
            {cash} <span className="trade-figures__currency">{cashCurrencyCode}</span>
          </dd>
        </div>
        <div className="trade-figures__item">
          <dt className="trade-figures__label">{t(`${ns}.figures.outstanding`)}</dt>
          <dd className="trade-figures__amount">
            {outstanding} <span className="trade-figures__currency">{outstandingCurrencyCode}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}
