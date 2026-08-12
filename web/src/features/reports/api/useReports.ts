import { useQuery } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

// Reports API hooks (P6-01/07). Cache keys namespaced per phase-6.md §5.

export interface ProfitReport {
  from: string;
  to: string;
  grossProfitMru: string;
  costOfCurrencySoldMru: string;
  realizedFxGainMru: string;
  expensesMru: string;
  netProfitMru: string;
  formula: string;
  byCurrency: Array<{
    currencyId: string;
    currencyCode: string;
    grossProfitMru: string;
    costOfCurrencySoldMru: string;
    revenueMru: string;
  }>;
  fxByCurrency: Array<{
    currencyId: string;
    currencyCode: string;
    realizedPnlMru: string;
  }>;
  expensesByCategory: Array<{
    expenseCategoryId: string;
    expenseCategoryName: string;
    amountMru: string;
  }>;
}

export interface ProfitFilters {
  from: string;
  to: string;
  currencyId?: string;
}

export function useProfitReport(filters: ProfitFilters) {
  const parts = [`from=${filters.from}`, `to=${filters.to}`];
  if (filters.currencyId) parts.push(`currencyId=${filters.currencyId}`);
  return useQuery<ProfitReport>({
    queryKey: ['reports', 'profit', filters],
    queryFn: () => request<ProfitReport>(`/reports/profit?${parts.join('&')}`),
  });
}

export interface UserActivityRow {
  userId: string;
  fullName: string;
  purchasesCreated: number;
  salesCreated: number;
  paymentsCreated: number;
  expensesCreated: number;
  reversalsPerformed: number;
  failedLogins: number;
}

export interface UserActivityFilters {
  from: string;
  to: string;
}

export function useUserActivity(filters: UserActivityFilters) {
  return useQuery<UserActivityRow[]>({
    queryKey: ['reports', 'user-activity', filters],
    queryFn: () =>
      request<UserActivityRow[]>(`/reports/user-activity?from=${filters.from}&to=${filters.to}`),
  });
}
