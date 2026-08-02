import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

export interface PaymentMethod {
  id: string;
  code: string;
  labelFr: string;
  labelAr: string;
  isActive: boolean;
  requiresNote: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePaymentMethodInput {
  code: string;
  labelFr: string;
  labelAr: string;
  requiresNote?: boolean;
}

export interface UpdatePaymentMethodInput {
  labelFr?: string;
  labelAr?: string;
}

export const PAYMENT_METHODS_KEY = ['payment-methods'] as const;

export function usePaymentMethods(includeInactive = false) {
  return useQuery<PaymentMethod[]>({
    queryKey: [...PAYMENT_METHODS_KEY, { includeInactive }],
    queryFn: () =>
      request<PaymentMethod[]>(`/payment-methods${includeInactive ? '?includeInactive=true' : ''}`),
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: PAYMENT_METHODS_KEY });
}

export function useCreatePaymentMethod() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePaymentMethodInput) =>
      request<PaymentMethod>('/payment-methods', { method: 'POST', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdatePaymentMethod(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdatePaymentMethodInput) =>
      request<PaymentMethod>(`/payment-methods/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeactivatePaymentMethod(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<PaymentMethod>(`/payment-methods/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useReactivatePaymentMethod(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request<PaymentMethod>(`/payment-methods/${id}/reactivate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}
