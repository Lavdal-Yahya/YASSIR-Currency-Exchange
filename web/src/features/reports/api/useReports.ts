import { useQuery } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

// Reports API hooks. Cache keys namespaced per phase-6.md §5 and
// phase-7.md §5.

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

// ----- P7-01 dashboard summary --------------------------------------------

export interface DashboardSummary {
  todayPurchases: { count: number; totalMru: string };
  todaySales: { count: number; totalMru: string };
  todayNetMru: string;
  openReceivables: { count: number; totalMru: string; hasNonMruDebts: boolean };
  openPayables: { count: number; totalMru: string; hasNonMruDebts: boolean };
  lowBalanceCurrencies: Array<{ code: string; cachedAmount: string; threshold: string }>;
}

export function useDashboardSummary() {
  return useQuery<DashboardSummary>({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => request<DashboardSummary>('/reports/dashboard'),
    staleTime: 60_000,
  });
}

// ----- P7-02 cash-flow report ---------------------------------------------

export interface CashFlowLeg {
  currencyCode: string;
  creditsTotal: string;
  debitsTotal: string;
}

export interface CashFlowMethodRow {
  paymentMethodId: string;
  paymentMethodName: string;
  byLeg: CashFlowLeg[];
}

export interface CashFlowReport {
  from: string;
  to: string;
  methods: CashFlowMethodRow[];
}

export interface CashFlowFilters {
  from: string;
  to: string;
}

export function useCashFlowReport(filters: CashFlowFilters) {
  return useQuery<CashFlowReport>({
    queryKey: ['reports', 'cash-flow', filters],
    queryFn: () =>
      request<CashFlowReport>(`/reports/cash-flow?from=${filters.from}&to=${filters.to}`),
  });
}

// ----- P7-03 ageing report ------------------------------------------------

export interface AgeingBucket {
  count: number;
  byCurrency: Array<{ currencyCode: string; total: string }>;
}

export interface AgeingSection {
  current: AgeingBucket;
  bucket31to60: AgeingBucket;
  bucket61to90: AgeingBucket;
  bucket91plus: AgeingBucket;
}

export interface AgeingReport {
  receivables: AgeingSection;
  payables: AgeingSection;
}

export function useAgeingReport() {
  return useQuery<AgeingReport>({
    queryKey: ['reports', 'ageing'],
    queryFn: () => request<AgeingReport>('/reports/ageing'),
  });
}
