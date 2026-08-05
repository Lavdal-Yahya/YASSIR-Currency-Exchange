import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BALANCES_KEY } from '../../openings/api/useOpenings';
import { request } from '../../../shared/api/client';

// Money stays string on the wire (D-002). Profit fields are optional
// because employees lack profit:view and the server omits them (D-018).

export interface Purchase {
  id: string;
  contactId: string | null;
  deliveredCurrencyId: string;
  deliveredAmount: string;
  paymentCurrencyId: string;
  paymentTotal: string;
  rate: string;
  immediatePayment: string;
  outstandingAmount: string;
  status: 'CONFIRMED' | 'CANCELLED' | 'REVERSED';
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  paymentMethodId: string | null;
  paymentMethodNote: string | null;
  reference: string | null;
  notes: string | null;
  transactionDate: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

export interface Sale extends Purchase {
  costOfCurrencySoldMru?: string;
  grossProfitMru?: string;
  recipientName: string | null;
  destination: string | null;
}

export interface TradeFilters {
  contactId?: string;
  status?: string;
  paymentStatus?: string;
  currencyId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
  offset?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
}

// ContactTradeItem is what GET /contacts/:id/trades returns for each item.
export type ContactTradeItem = ({ kind: 'purchase' } & Purchase) | ({ kind: 'sale' } & Sale);

export const PURCHASES_KEY = ['purchases'] as const;
export const SALES_KEY = ['sales'] as const;

function tradeQueryString(f: TradeFilters): string {
  const parts: string[] = [];
  if (f.contactId) parts.push(`contactId=${f.contactId}`);
  if (f.status) parts.push(`status=${f.status}`);
  if (f.paymentStatus) parts.push(`paymentStatus=${f.paymentStatus}`);
  if (f.currencyId) parts.push(`currencyId=${f.currencyId}`);
  if (f.dateFrom) parts.push(`dateFrom=${f.dateFrom}`);
  if (f.dateTo) parts.push(`dateTo=${f.dateTo}`);
  if (f.limit !== undefined) parts.push(`limit=${f.limit}`);
  if (f.offset !== undefined) parts.push(`offset=${f.offset}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// ---------------------------------------------------------------------------
// Purchases
// ---------------------------------------------------------------------------

export function usePurchases(filters: TradeFilters = {}) {
  return useQuery<PaginatedResponse<Purchase>>({
    queryKey: [...PURCHASES_KEY, filters],
    queryFn: () => request<PaginatedResponse<Purchase>>(`/purchases${tradeQueryString(filters)}`),
  });
}

export function usePurchase(id: string | undefined) {
  return useQuery<Purchase>({
    queryKey: [...PURCHASES_KEY, id],
    queryFn: () => request<Purchase>(`/purchases/${id}`),
    enabled: !!id,
  });
}

export interface CreatePurchaseInput {
  deliveredCurrencyId: string;
  deliveredAmount: string;
  paymentCurrencyId: string;
  rate?: string;
  paymentTotal?: string;
  immediatePayment?: string;
  paymentMethodId?: string;
  paymentMethodNote?: string;
  contactId?: string;
  reference?: string;
  notes?: string;
  transactionDate?: string;
}

export function useCreatePurchase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      input,
      idempotencyKey,
    }: {
      input: CreatePurchaseInput;
      idempotencyKey: string;
    }) =>
      request<Purchase>('/purchases', {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: PURCHASES_KEY });
      qc.invalidateQueries({ queryKey: BALANCES_KEY });
      if (vars.input.contactId) {
        qc.invalidateQueries({ queryKey: ['contact', vars.input.contactId, 'trades'] });
        qc.invalidateQueries({ queryKey: ['contact', vars.input.contactId, 'debts'] });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export function useSales(filters: TradeFilters = {}) {
  return useQuery<PaginatedResponse<Sale>>({
    queryKey: [...SALES_KEY, filters],
    queryFn: () => request<PaginatedResponse<Sale>>(`/sales${tradeQueryString(filters)}`),
  });
}

export function useSale(id: string | undefined) {
  return useQuery<Sale>({
    queryKey: [...SALES_KEY, id],
    queryFn: () => request<Sale>(`/sales/${id}`),
    enabled: !!id,
  });
}

export interface CreateSaleInput extends CreatePurchaseInput {
  recipientName?: string;
  destination?: string;
}

export function useCreateSale() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ input, idempotencyKey }: { input: CreateSaleInput; idempotencyKey: string }) =>
      request<Sale>('/sales', {
        method: 'POST',
        body: input,
        headers: { 'Idempotency-Key': idempotencyKey },
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: SALES_KEY });
      qc.invalidateQueries({ queryKey: BALANCES_KEY });
      if (vars.input.contactId) {
        qc.invalidateQueries({ queryKey: ['contact', vars.input.contactId, 'trades'] });
        qc.invalidateQueries({ queryKey: ['contact', vars.input.contactId, 'debts'] });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Contact trades (unified timeline)
// ---------------------------------------------------------------------------

export function useContactTrades(contactId: string | undefined, limit = 50, offset = 0) {
  return useQuery<PaginatedResponse<ContactTradeItem>>({
    queryKey: ['contact', contactId, 'trades', { limit, offset }],
    queryFn: () =>
      request<PaginatedResponse<ContactTradeItem>>(
        `/contacts/${contactId}/trades?limit=${limit}&offset=${offset}`,
      ),
    enabled: !!contactId,
  });
}

// ---------------------------------------------------------------------------
// Recent rate lookup — used for the reversed-rate sanity warning.
// Fetches recent purchases/sales with the given delivered currency,
// then picks the most recent one matching the payment currency.
// ---------------------------------------------------------------------------

export function useLastTradeRate(
  deliveredCurrencyId: string | undefined,
  paymentCurrencyId: string | undefined,
) {
  const purchases = useQuery<PaginatedResponse<Purchase>>({
    queryKey: ['last-rate', 'purchases', deliveredCurrencyId, paymentCurrencyId],
    queryFn: () =>
      request<PaginatedResponse<Purchase>>(`/purchases?currencyId=${deliveredCurrencyId}&limit=10`),
    enabled: !!(deliveredCurrencyId && paymentCurrencyId),
    staleTime: 60_000,
  });

  const sales = useQuery<PaginatedResponse<Sale>>({
    queryKey: ['last-rate', 'sales', deliveredCurrencyId, paymentCurrencyId],
    queryFn: () =>
      request<PaginatedResponse<Sale>>(`/sales?currencyId=${deliveredCurrencyId}&limit=10`),
    enabled: !!(deliveredCurrencyId && paymentCurrencyId),
    staleTime: 60_000,
  });

  if (!deliveredCurrencyId || !paymentCurrencyId) return undefined;

  // Find the most recent matching pair across both purchase and sale lists.
  const matchingPurchase = purchases.data?.data.find(
    (p) =>
      p.deliveredCurrencyId === deliveredCurrencyId && p.paymentCurrencyId === paymentCurrencyId,
  );
  const matchingSale = sales.data?.data.find(
    (s) =>
      s.deliveredCurrencyId === deliveredCurrencyId && s.paymentCurrencyId === paymentCurrencyId,
  );

  // Return the rate from whichever was more recent.
  if (matchingPurchase && matchingSale) {
    return matchingPurchase.transactionDate >= matchingSale.transactionDate
      ? matchingPurchase.rate
      : matchingSale.rate;
  }
  return (matchingPurchase ?? matchingSale)?.rate;
}
