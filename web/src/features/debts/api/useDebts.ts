import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BALANCES_KEY } from '../../openings/api/useOpenings';
import { request } from '../../../shared/api/client';

// Money on the wire is a string (D-002). Receivable/Payable/Payment
// shapes mirror the API's Prisma models. Age-bucket filter is applied
// server-side using common/period.ts so DST cannot shift boundaries
// (phase-5.md §5).

export type AgeBucket = '0-7' | '8-30' | '31-60' | '60+';

export interface Receivable {
  id: string;
  contactId: string;
  currencyId: string;
  originalAmount: string;
  outstandingAmount: string;
  origin: 'TRADE' | 'OPENING';
  sourceType: string | null;
  sourceId: string | null;
  status: 'OPEN' | 'CLOSED' | 'REVERSED';
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  createdAt: string;
  updatedAt: string;
}

export type Payable = Receivable;

export interface Payment {
  id: string;
  contactId: string;
  currencyId: string;
  amount: string;
  direction: 'RECEIVED_FROM_CUSTOMER' | 'PAID_TO_SUPPLIER';
  paymentMethodId: string;
  paymentMethodNote: string | null;
  status: 'CONFIRMED' | 'REVERSED';
  reference: string | null;
  notes: string | null;
  transactionDate: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  reversalReason?: string | null;
  reversedByUserId?: string | null;
  reversedAt?: string | null;
}

export function usePayment(id: string | undefined) {
  return useQuery<Payment>({
    queryKey: [...PAYMENTS_KEY, id],
    queryFn: () => request<Payment>(`/payments/${id}`),
    enabled: !!id,
  });
}

export interface Paginated<T> {
  data: T[];
  total: number;
}

export interface DebtFilters {
  contactId?: string;
  currencyId?: string;
  status?: string;
  paymentStatus?: string;
  ageBucket?: AgeBucket;
  limit?: number;
  offset?: number;
}

export interface PaymentFilters {
  contactId?: string;
  currencyId?: string;
  direction?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export const RECEIVABLES_KEY = ['receivables'] as const;
export const PAYABLES_KEY = ['payables'] as const;
export const PAYMENTS_KEY = ['payments'] as const;

function debtQs(f: DebtFilters): string {
  const parts: string[] = [];
  if (f.contactId) parts.push(`contactId=${encodeURIComponent(f.contactId)}`);
  if (f.currencyId) parts.push(`currencyId=${encodeURIComponent(f.currencyId)}`);
  if (f.status) parts.push(`status=${encodeURIComponent(f.status)}`);
  if (f.paymentStatus) parts.push(`paymentStatus=${encodeURIComponent(f.paymentStatus)}`);
  if (f.ageBucket) parts.push(`ageBucket=${encodeURIComponent(f.ageBucket)}`);
  if (f.limit !== undefined) parts.push(`limit=${f.limit}`);
  if (f.offset !== undefined) parts.push(`offset=${f.offset}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

function paymentQs(f: PaymentFilters): string {
  const parts: string[] = [];
  if (f.contactId) parts.push(`contactId=${encodeURIComponent(f.contactId)}`);
  if (f.currencyId) parts.push(`currencyId=${encodeURIComponent(f.currencyId)}`);
  if (f.direction) parts.push(`direction=${encodeURIComponent(f.direction)}`);
  if (f.status) parts.push(`status=${encodeURIComponent(f.status)}`);
  if (f.dateFrom) parts.push(`dateFrom=${encodeURIComponent(f.dateFrom)}`);
  if (f.dateTo) parts.push(`dateTo=${encodeURIComponent(f.dateTo)}`);
  if (f.limit !== undefined) parts.push(`limit=${f.limit}`);
  if (f.offset !== undefined) parts.push(`offset=${f.offset}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// ---------- Receivables ----------------------------------------------------

export function useReceivables(filters: DebtFilters = {}) {
  return useQuery<Paginated<Receivable>>({
    queryKey: [...RECEIVABLES_KEY, filters],
    queryFn: () => request<Paginated<Receivable>>(`/receivables${debtQs(filters)}`),
  });
}

export function useReceivable(id: string | undefined) {
  return useQuery<Receivable>({
    queryKey: [...RECEIVABLES_KEY, id],
    queryFn: () => request<Receivable>(`/receivables/${id}`),
    enabled: !!id,
  });
}

// ---------- Payables -------------------------------------------------------

export function usePayables(filters: DebtFilters = {}) {
  return useQuery<Paginated<Payable>>({
    queryKey: [...PAYABLES_KEY, filters],
    queryFn: () => request<Paginated<Payable>>(`/payables${debtQs(filters)}`),
  });
}

export function usePayable(id: string | undefined) {
  return useQuery<Payable>({
    queryKey: [...PAYABLES_KEY, id],
    queryFn: () => request<Payable>(`/payables/${id}`),
    enabled: !!id,
  });
}

// ---------- Payments (list) ------------------------------------------------

export function usePayments(filters: PaymentFilters = {}) {
  return useQuery<Paginated<Payment>>({
    queryKey: [...PAYMENTS_KEY, filters],
    queryFn: () => request<Paginated<Payment>>(`/payments${paymentQs(filters)}`),
  });
}

// ---------- Customer payment (receive) ------------------------------------

export interface CreateCustomerPaymentInput {
  contactId: string;
  currencyId: string;
  amount: string;
  paymentMethodId: string;
  paymentMethodNote?: string;
  reference?: string;
  notes?: string;
  transactionDate?: string;
  /** MRU unit cost when settling a non-base receivable. */
  unitCostMru?: string;
}

export function useCreateCustomerPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCustomerPaymentInput) =>
      request<Payment>('/customer-payments', { method: 'POST', body: input }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: RECEIVABLES_KEY });
      qc.invalidateQueries({ queryKey: PAYMENTS_KEY });
      qc.invalidateQueries({ queryKey: BALANCES_KEY });
      qc.invalidateQueries({ queryKey: ['contact', vars.contactId, 'debts'] });
    },
  });
}

// ---------- Supplier payment (pay) ----------------------------------------

export interface CreateSupplierPaymentInput {
  contactId: string;
  currencyId: string;
  amount: string;
  paymentMethodId: string;
  paymentMethodNote?: string;
  reference?: string;
  notes?: string;
  transactionDate?: string;
}

export function useCreateSupplierPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSupplierPaymentInput) =>
      request<Payment>('/supplier-payments', { method: 'POST', body: input }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: PAYABLES_KEY });
      qc.invalidateQueries({ queryKey: PAYMENTS_KEY });
      qc.invalidateQueries({ queryKey: BALANCES_KEY });
      qc.invalidateQueries({ queryKey: ['contact', vars.contactId, 'debts'] });
    },
  });
}
