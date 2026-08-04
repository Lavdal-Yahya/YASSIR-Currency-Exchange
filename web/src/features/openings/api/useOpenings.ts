import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

// Money on the wire stays a string (D-002). The backend serialises
// Decimal as string; the browser passes it through untouched.
//
// Cache keys: `['openings']` for the openings home page, `['balances']`
// for the dashboard card grid. Mutations invalidate them narrowly —
// no blanket invalidateQueries() (conventions §4).

export interface OpeningBalance {
  id: string;
  currencyId: string;
  quantity: string;
  openingAvgCostMru: string;
  effectiveDate: string;
  createdAt: string;
}

export interface Receivable {
  id: string;
  contactId: string;
  currencyId: string;
  originalAmount: string;
  outstandingAmount: string;
  origin: 'TRADE' | 'OPENING';
  status: 'OPEN' | 'CLOSED' | 'REVERSED';
}

export interface Payable extends Receivable {}

export interface OpeningsResponse {
  balances: OpeningBalance[];
  debts: { receivables: Receivable[]; payables: Payable[] };
  isPostGoLive: boolean;
}

export interface CreateOpeningBalanceInput {
  currencyId: string;
  quantity: string;
  openingAvgCostMru: string;
  effectiveDate: string; // YYYY-MM-DD
}

export interface CreateOpeningDebtInput {
  contactId: string;
  currencyId: string;
  amount: string;
  side: 'receivable' | 'payable';
}

export const OPENINGS_KEY = ['openings'] as const;
export const BALANCES_KEY = ['balances'] as const;

export function useOpenings() {
  return useQuery<OpeningsResponse>({
    queryKey: OPENINGS_KEY,
    queryFn: () => request<OpeningsResponse>('/openings'),
  });
}

export function useCreateOpeningBalance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOpeningBalanceInput) =>
      request<OpeningBalance>('/openings/currency', { method: 'POST', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: OPENINGS_KEY });
      qc.invalidateQueries({ queryKey: BALANCES_KEY });
    },
  });
}

export function useCreateOpeningDebt() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateOpeningDebtInput) =>
      request<{ side: 'receivable' | 'payable'; row: Receivable }>('/openings/debt', {
        method: 'POST',
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: OPENINGS_KEY }),
  });
}

// Balances read API (P3-05). Kept in the same feature file so the
// dashboard card and the openings home page share one cache
// invalidation surface.

export interface BalanceRow {
  currencyId: string;
  code: string;
  name: string;
  symbol: string | null;
  decimalPlaces: number;
  lowBalanceThreshold: string | null;
  cachedAmount: string;
  cachedAvgMru: string;
  cachedQuantity: string;
  lastMovementAt: string | null;
}

export function useBalances() {
  return useQuery<BalanceRow[]>({
    queryKey: BALANCES_KEY,
    queryFn: () => request<BalanceRow[]>('/balances'),
  });
}
