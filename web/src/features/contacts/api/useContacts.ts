import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

export interface Contact {
  id: string;
  name: string;
  phone: string | null;
  isCustomer: boolean;
  isSupplier: boolean;
  isArchived: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactInput {
  name: string;
  phone?: string | null;
  isCustomer?: boolean;
  isSupplier?: boolean;
  notes?: string | null;
  confirmDuplicate?: boolean;
}

export interface ContactFilters {
  includeArchived?: boolean;
  isCustomer?: boolean;
  isSupplier?: boolean;
  search?: string;
}

export const CONTACTS_KEY = ['contacts'] as const;

function queryString(filters: ContactFilters): string {
  const parts: string[] = [];
  if (filters.includeArchived) parts.push('includeArchived=true');
  if (filters.isCustomer !== undefined) parts.push(`isCustomer=${filters.isCustomer}`);
  if (filters.isSupplier !== undefined) parts.push(`isSupplier=${filters.isSupplier}`);
  if (filters.search && filters.search.trim().length > 0) {
    parts.push(`search=${encodeURIComponent(filters.search.trim())}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

export function useContacts(filters: ContactFilters = {}) {
  return useQuery<Contact[]>({
    queryKey: [...CONTACTS_KEY, filters],
    queryFn: () => request<Contact[]>(`/contacts${queryString(filters)}`),
  });
}

export function useContact(id: string | undefined) {
  return useQuery<Contact>({
    queryKey: [...CONTACTS_KEY, id],
    queryFn: () => request<Contact>(`/contacts/${id}`),
    enabled: !!id,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: CONTACTS_KEY });
}

export function useCreateContact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ContactInput) =>
      request<Contact>('/contacts', { method: 'POST', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Partial<ContactInput>) =>
      request<Contact>(`/contacts/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useArchiveContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<Contact>(`/contacts/${id}/archive`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUnarchiveContact(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<Contact>(`/contacts/${id}/unarchive`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}
