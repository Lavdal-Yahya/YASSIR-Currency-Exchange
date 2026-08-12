import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';
import { BALANCES_KEY } from '../../openings/api/useOpenings';
import { PURCHASES_KEY, SALES_KEY } from '../../trades/api/useTrades';
import { PAYABLES_KEY, PAYMENTS_KEY, RECEIVABLES_KEY } from '../../debts/api/useDebts';

// P6 reversal mutations. Each targets one endpoint; on success we
// invalidate a wide net (this is the one place broad invalidation is
// defensible per phase-6.md §5 — reversal touches everything).

export interface ReverseInput {
  id: string;
  reason: string;
}

export interface TradeReversalResult {
  tradeId: string;
  tradeKind: 'purchase' | 'sale';
  restatedSaleIds: string[];
}

function bustAll(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: PURCHASES_KEY });
  qc.invalidateQueries({ queryKey: SALES_KEY });
  qc.invalidateQueries({ queryKey: PAYMENTS_KEY });
  qc.invalidateQueries({ queryKey: RECEIVABLES_KEY });
  qc.invalidateQueries({ queryKey: PAYABLES_KEY });
  qc.invalidateQueries({ queryKey: BALANCES_KEY });
  qc.invalidateQueries({ queryKey: ['expenses'] });
  qc.invalidateQueries({ queryKey: ['reports'] });
  qc.invalidateQueries({ queryKey: ['audit'] });
  // Any contact-scoped debts/trades cache — safe wildcard invalidation.
  qc.invalidateQueries({ queryKey: ['contact'] });
}

export function useReversePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: ReverseInput) =>
      request<TradeReversalResult>(`/purchases/${id}/reverse`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => bustAll(qc),
  });
}

export function useReverseSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: ReverseInput) =>
      request<TradeReversalResult>(`/sales/${id}/reverse`, {
        method: 'POST',
        body: { reason },
      }),
    onSuccess: () => bustAll(qc),
  });
}

export function useReversePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: ReverseInput) =>
      request(`/payments/${id}/reverse`, { method: 'POST', body: { reason } }),
    onSuccess: () => bustAll(qc),
  });
}

export function useReverseExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: ReverseInput) =>
      request(`/expenses/${id}/reverse`, { method: 'POST', body: { reason } }),
    onSuccess: () => bustAll(qc),
  });
}
