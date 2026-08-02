import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

export interface ExpenseCategory {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export const EXPENSE_CATEGORIES_KEY = ['expense-categories'] as const;

export function useExpenseCategories(includeInactive = false) {
  return useQuery<ExpenseCategory[]>({
    queryKey: [...EXPENSE_CATEGORIES_KEY, { includeInactive }],
    queryFn: () =>
      request<ExpenseCategory[]>(
        `/expense-categories${includeInactive ? '?includeInactive=true' : ''}`,
      ),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: EXPENSE_CATEGORIES_KEY });
}

export function useCreateExpenseCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      request<ExpenseCategory>('/expense-categories', { method: 'POST', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateExpenseCategory(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name?: string }) =>
      request<ExpenseCategory>(`/expense-categories/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeactivateExpenseCategory(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<ExpenseCategory>(`/expense-categories/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useReactivateExpenseCategory(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<ExpenseCategory>(`/expense-categories/${id}/reactivate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}
