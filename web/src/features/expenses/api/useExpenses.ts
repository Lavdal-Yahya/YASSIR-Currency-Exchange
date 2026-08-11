import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BALANCES_KEY } from '../../openings/api/useOpenings';
import { request } from '../../../shared/api/client';

export interface Expense {
  id: string;
  expenseCategoryId: string;
  currencyId: string;
  amount: string;
  paymentMethodId: string;
  paymentMethodNote: string | null;
  description: string;
  status: 'CONFIRMED' | 'REVERSED';
  transactionDate: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpenseFilters {
  expenseCategoryId?: string;
  currencyId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedExpenses {
  data: Expense[];
  total: number;
}

export const EXPENSES_KEY = ['expenses'] as const;

function expenseQs(f: ExpenseFilters): string {
  const parts: string[] = [];
  if (f.expenseCategoryId)
    parts.push(`expenseCategoryId=${encodeURIComponent(f.expenseCategoryId)}`);
  if (f.currencyId) parts.push(`currencyId=${encodeURIComponent(f.currencyId)}`);
  if (f.dateFrom) parts.push(`dateFrom=${encodeURIComponent(f.dateFrom)}`);
  if (f.dateTo) parts.push(`dateTo=${encodeURIComponent(f.dateTo)}`);
  if (f.limit !== undefined) parts.push(`limit=${f.limit}`);
  if (f.offset !== undefined) parts.push(`offset=${f.offset}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function useExpenses(filters: ExpenseFilters = {}) {
  return useQuery<PaginatedExpenses>({
    queryKey: [...EXPENSES_KEY, filters],
    queryFn: () => request<PaginatedExpenses>(`/expenses${expenseQs(filters)}`),
  });
}

export interface CreateExpenseInput {
  expenseCategoryId: string;
  currencyId: string;
  amount: string;
  paymentMethodId: string;
  paymentMethodNote?: string;
  description: string;
  transactionDate?: string;
}

export function useCreateExpense() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateExpenseInput) =>
      request<Expense>('/expenses', { method: 'POST', body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EXPENSES_KEY });
      qc.invalidateQueries({ queryKey: BALANCES_KEY });
    },
  });
}
