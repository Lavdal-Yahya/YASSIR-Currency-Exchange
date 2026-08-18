import { useQuery } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

export interface LedgerEntry {
  id: string;
  currencyId: string;
  direction: 'CREDIT' | 'DEBIT';
  amount: string;
  sourceType: string;
  sourceId: string | null;
  description: string;
  transactionDate: string;
  isActive: boolean;
  createdAt: string;
}

export interface LedgerPage {
  rows: LedgerEntry[];
  total: number;
}

export function useCurrencyLedger(currencyId: string | undefined, limit = 30, offset = 0) {
  return useQuery<LedgerPage>({
    queryKey: ['ledger', currencyId, { limit, offset }],
    queryFn: () =>
      request<LedgerPage>(`/ledger?currencyId=${currencyId}&limit=${limit}&offset=${offset}`),
    enabled: !!currencyId,
  });
}
