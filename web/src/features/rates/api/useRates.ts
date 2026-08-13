import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

// Rate hooks (P8-05). Suggested rates come from the rate_snapshot table
// via the RatesController. Never authoritative — the trade form's typed
// rate is what matters (spec §21.2). The chip is a courtesy.

export interface CurrentRate {
  currencyId: string;
  currencyCode: string;
  midRateMru: string;
  source: string;
  fetchedAt: string;
}

export interface RateHistoryEntry {
  id: string;
  midRateMru: string;
  source: string;
  fetchedAt: string;
  isCurrent: boolean;
}

export const RATES_KEY = ['rates'] as const;

export function useCurrentRates() {
  return useQuery<CurrentRate[]>({
    queryKey: [...RATES_KEY, 'current'],
    queryFn: () => request<CurrentRate[]>('/rates'),
    staleTime: 5 * 60_000,
  });
}

export function useRateHistory(currencyId: string | undefined, limit = 30) {
  return useQuery<RateHistoryEntry[]>({
    queryKey: [...RATES_KEY, 'history', currencyId, limit],
    queryFn: () =>
      request<RateHistoryEntry[]>(`/rates/history?currencyId=${currencyId}&limit=${limit}`),
    enabled: !!currencyId,
  });
}

export function useRefreshRates() {
  const qc = useQueryClient();
  return useMutation<{ refreshed: number; failed: number }, unknown, void>({
    mutationFn: () =>
      request<{ refreshed: number; failed: number }>('/rates/refresh', { method: 'POST' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: RATES_KEY });
    },
  });
}
