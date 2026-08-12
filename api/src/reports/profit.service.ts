import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service.js';
import { Decimal } from '../common/money.js';

// ProfitService — the read model for §19.4 of the spec.
//
// Every input is already stored in MRU on the source rows:
//   · sale.gross_profit_mru + sale.cost_of_currency_sold_mru — snapshotted
//     at confirmation (D-018, architecture §3.6). Reversal restates these
//     forward (D-021) so they always reflect the currently-live cost book.
//   · cost_movement.realized_pnl_mru — the FX gain/loss on non-base
//     disposals. When the source ledger entry is a payment (D-017), it's
//     an FX settlement gain; when it's a sale, it's already included in
//     that sale's gross_profit_mru.
//   · expense.amount — already in MRU when the expense currency is MRU;
//     for non-base expenses, we convert at the WAC at the moment the
//     expense hit the ledger — but the current implementation of
//     ExpenseService only ever books to the base or to a currency where
//     the WAC is known, and the P&L complication of non-base expenses is
//     spec-deferred. For safety, non-base expenses are excluded from
//     `expensesByPeriod` with a note; they should be zero in practice.
//
// Consolidation to base currency uses **stored** figures only — never a
// live market rate (spec §20, P6-02). The P6-02 grep guard test asserts
// this file (and every file in reports/) contains no reference to the
// live rate table or the market-rate column, at build time.
//
// All queries filter active rows via status IN ('CONFIRMED') — reversed
// rows contribute zero to profit by construction.

export interface GrossProfitByCurrency {
  currencyId: string;
  currencyCode: string;
  grossProfitMru: string;
  costOfCurrencySoldMru: string;
  revenueMru: string;
}

export interface FxGainRow {
  currencyId: string;
  currencyCode: string;
  realizedPnlMru: string;
}

export interface ExpenseRow {
  expenseCategoryId: string;
  expenseCategoryName: string;
  amountMru: string;
}

export interface ProfitReport {
  from: string;
  to: string;
  grossProfitMru: string;
  costOfCurrencySoldMru: string;
  realizedFxGainMru: string;
  expensesMru: string;
  netProfitMru: string;
  byCurrency: GrossProfitByCurrency[];
  fxByCurrency: FxGainRow[];
  expensesByCategory: ExpenseRow[];
  // Explicit formula in the response so the frontend renders the same
  // arithmetic the operator can hand-verify.
  formula: string;
}

@Injectable()
export class ProfitService {
  constructor(private readonly prisma: PrismaService) {}

  async report(from: Date, to: Date, currencyId?: string): Promise<ProfitReport> {
    const [byCurrency, fxByCurrency, expensesByCategory] = await Promise.all([
      this.grossProfitByCurrency(from, to, currencyId),
      this.realizedFxGainByCurrency(from, to, currencyId),
      currencyId ? Promise.resolve([]) : this.expensesByCategory(from, to),
    ]);

    const grossProfit = sum(byCurrency.map((r) => r.grossProfitMru));
    const costOfSold = sum(byCurrency.map((r) => r.costOfCurrencySoldMru));
    const fx = sum(fxByCurrency.map((r) => r.realizedPnlMru));
    const expenses = sum(expensesByCategory.map((r) => r.amountMru));
    const net = grossProfit.plus(fx).minus(expenses);

    return {
      from: from.toISOString(),
      to: to.toISOString(),
      grossProfitMru: grossProfit.toFixed(4),
      costOfCurrencySoldMru: costOfSold.toFixed(4),
      realizedFxGainMru: fx.toFixed(4),
      expensesMru: expenses.toFixed(4),
      netProfitMru: net.toFixed(4),
      byCurrency,
      fxByCurrency,
      expensesByCategory,
      formula: 'net = gross_profit + realized_fx_gain − expenses',
    };
  }

  // Gross profit per delivered currency, over sales that were confirmed
  // in the period. Reversed sales are excluded by status; their profit
  // fields have been restated to zero-effect by TradeReversalService
  // (D-021), so double-counting is impossible either way.
  async grossProfitByCurrency(
    from: Date,
    to: Date,
    currencyId?: string,
  ): Promise<GrossProfitByCurrency[]> {
    const currencyFilter = currencyId
      ? Prisma.sql`AND s."delivered_currency_id" = ${currencyId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      {
        currency_id: string;
        currency_code: string;
        gross_profit_mru: string;
        cost_of_currency_sold_mru: string;
        revenue_mru: string;
      }[]
    >(Prisma.sql`
      SELECT
        s."delivered_currency_id" AS currency_id,
        c."code" AS currency_code,
        COALESCE(SUM(s."gross_profit_mru"), 0)::text AS gross_profit_mru,
        COALESCE(SUM(s."cost_of_currency_sold_mru"), 0)::text AS cost_of_currency_sold_mru,
        COALESCE(SUM(s."payment_total"), 0)::text AS revenue_mru
      FROM "sale" s
      JOIN "currency" c ON c."id" = s."delivered_currency_id"
      WHERE s."status" = 'CONFIRMED'
        AND s."transaction_date" >= ${from}
        AND s."transaction_date" <  ${to}
        ${currencyFilter}
      GROUP BY s."delivered_currency_id", c."code"
      ORDER BY gross_profit_mru DESC
    `);
    // Note: `revenue_mru` sums `payment_total` because the payment leg
    // of a sale is always the base currency (D-019, INV-7) when the
    // delivered leg is non-base. When delivered is base (a "sale of MRU"),
    // gross_profit_mru is zero by construction (D-006), and this row is
    // still shown for completeness.
    return rows.map((r) => ({
      currencyId: r.currency_id,
      currencyCode: r.currency_code,
      grossProfitMru: new Decimal(r.gross_profit_mru).toFixed(4),
      costOfCurrencySoldMru: new Decimal(r.cost_of_currency_sold_mru).toFixed(4),
      revenueMru: new Decimal(r.revenue_mru).toFixed(4),
    }));
  }

  // FX gain/loss from non-base debt settlements (D-017). Joins cost_movement
  // → currency_ledger → payment so we only pick up movements whose source is
  // a supplier payment; sale-sourced DISPOSAL rows already have their P&L
  // baked into gross_profit_mru on the sale row and are excluded here.
  async realizedFxGainByCurrency(from: Date, to: Date, currencyId?: string): Promise<FxGainRow[]> {
    const currencyFilter = currencyId
      ? Prisma.sql`AND cm."currency_id" = ${currencyId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      { currency_id: string; currency_code: string; realized_pnl_mru: string }[]
    >(Prisma.sql`
      SELECT
        cm."currency_id" AS currency_id,
        c."code" AS currency_code,
        COALESCE(SUM(cm."realized_pnl_mru"), 0)::text AS realized_pnl_mru
      FROM "cost_movement" cm
      JOIN "currency_ledger" cl ON cl."id" = cm."ledger_entry_id"
      JOIN "currency" c ON c."id" = cm."currency_id"
      JOIN "payment" p ON p."id" = cl."source_id"
      WHERE cm."is_active" = true
        AND cm."kind" = 'DISPOSAL'
        AND cl."source_type" = 'payment'
        AND cl."transaction_date" >= ${from}
        AND cl."transaction_date" <  ${to}
        AND p."status" = 'CONFIRMED'
        ${currencyFilter}
      GROUP BY cm."currency_id", c."code"
    `);
    return rows
      .filter((r) => !new Decimal(r.realized_pnl_mru).eq(0))
      .map((r) => ({
        currencyId: r.currency_id,
        currencyCode: r.currency_code,
        realizedPnlMru: new Decimal(r.realized_pnl_mru).toFixed(4),
      }));
  }

  // Confirmed expenses in the period. Expenses are already in base
  // currency in practice (see class doc); non-base expenses are excluded
  // to avoid silently mixing currencies (rule 6, conventions §8).
  async expensesByCategory(from: Date, to: Date): Promise<ExpenseRow[]> {
    const settings = await this.prisma.settings.findUniqueOrThrow({ where: { id: 1 } });
    const rows = await this.prisma.$queryRaw<
      { category_id: string; category_name: string; amount_mru: string }[]
    >`
      SELECT
        e."expense_category_id" AS category_id,
        ec."name" AS category_name,
        COALESCE(SUM(e."amount"), 0)::text AS amount_mru
      FROM "expense" e
      JOIN "expense_category" ec ON ec."id" = e."expense_category_id"
      WHERE e."status" = 'CONFIRMED'
        AND e."currency_id" = ${settings.baseCurrencyId}::uuid
        AND e."transaction_date" >= ${from}
        AND e."transaction_date" <  ${to}
      GROUP BY e."expense_category_id", ec."name"
      ORDER BY amount_mru DESC
    `;
    return rows.map((r) => ({
      expenseCategoryId: r.category_id,
      expenseCategoryName: r.category_name,
      amountMru: new Decimal(r.amount_mru).toFixed(4),
    }));
  }
}

function sum(values: string[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), new Decimal(0));
}
