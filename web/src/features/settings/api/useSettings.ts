import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

export interface Settings {
  id: number;
  baseCurrencyId: string;
  businessTimezone: string;
  negativeBalanceOverrideAllowed: boolean;
  goLiveAt: string | null;
  updatedAt: string;
  updatedByUserId: string | null;
}

export interface UpdateSettingsInput {
  baseCurrencyId?: string;
  businessTimezone?: string;
  negativeBalanceOverrideAllowed?: boolean;
}

export const SETTINGS_KEY = ['settings'] as const;

export function useSettings() {
  return useQuery<Settings>({
    queryKey: SETTINGS_KEY,
    queryFn: () => request<Settings>('/settings'),
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateSettingsInput) =>
      request<Settings>('/settings', { method: 'PATCH', body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
}

export function useGoLive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<Settings>('/settings/go-live', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
}
