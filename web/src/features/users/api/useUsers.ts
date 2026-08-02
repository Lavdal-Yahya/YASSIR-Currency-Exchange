import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';

export interface User {
  id: string;
  phone: string;
  fullName: string;
  isActive: boolean;
  roles: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateUserInput {
  fullName: string;
  phone: string;
  pin: string;
  roles?: string[];
  isActive?: boolean;
}

export interface UpdateUserInput {
  fullName?: string;
}

export const USERS_KEY = ['users'] as const;

export function useUsers(includeInactive = false) {
  return useQuery<User[]>({
    queryKey: [...USERS_KEY, { includeInactive }],
    queryFn: () => request<User[]>(`/users${includeInactive ? '?includeInactive=true' : ''}`),
  });
}

export function useUser(id: string | undefined) {
  return useQuery<User>({
    queryKey: [...USERS_KEY, id],
    queryFn: () => request<User>(`/users/${id}`),
    enabled: !!id,
  });
}

function invalidate(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: USERS_KEY });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUserInput) =>
      request<{ id: string; phone: string }>('/users', { method: 'POST', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useUpdateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateUserInput) =>
      request<User>(`/users/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => invalidate(qc),
  });
}

export function useDeactivateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<void>(`/users/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useReactivateUser(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request<void>(`/users/${id}/reactivate`, { method: 'POST' }),
    onSuccess: () => invalidate(qc),
  });
}

export function useSetUserRoles(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roles: string[]) =>
      request<User>(`/users/${id}/roles`, { method: 'PATCH', body: { roles } }),
    onSuccess: () => invalidate(qc),
  });
}

export function useResetUserPin(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pin: string) =>
      request<void>(`/users/${id}/reset-pin`, { method: 'POST', body: { pin } }),
    onSuccess: () => invalidate(qc),
  });
}
