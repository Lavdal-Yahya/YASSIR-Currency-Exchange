import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

// Cache key `['currencies']` — every page that reads the list uses this,
// every mutation invalidates it. Money-shaped fields (lowBalanceThreshold)
// stay STRING on the wire per D-002.

export interface Currency {
  id: string;
  code: string;
  name: string;
  symbol: string | null;
  decimalPlaces: number;
  lowBalanceThreshold: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CurrencyInput {
  code: string;
  name: string;
  symbol?: string | null;
  decimalPlaces: number;
  lowBalanceThreshold?: string | null;
  isActive?: boolean;
}

export const CURRENCIES_KEY = ['currencies'] as const;

export function useCurrencies(includeInactive = false) {
  return useQuery<Currency[]>({
    queryKey: [...CURRENCIES_KEY, { includeInactive }],
    queryFn: () =>
      request<Currency[]>(`/currencies${includeInactive ? '?includeInactive=true' : ''}`),
  });
}

export function useCurrency(id: string | undefined) {
  return useQuery<Currency>({
    queryKey: [...CURRENCIES_KEY, id],
    queryFn: () => request<Currency>(`/currencies/${id}`),
    enabled: !!id,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CURRENCIES_KEY });
}

export function useCreateCurrency() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CurrencyInput) =>
      request<Currency>('/currencies', { method: 'POST', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateCurrency(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<CurrencyInput>) =>
      request<Currency>(`/currencies/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeactivateCurrency(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<Currency>(`/currencies/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useReactivateCurrency(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<Currency>(`/currencies/${id}/reactivate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}
