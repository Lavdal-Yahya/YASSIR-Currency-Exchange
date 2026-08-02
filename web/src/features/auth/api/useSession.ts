import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '../../../shared/api/client';
import { AUTH_ME_KEY } from '../../../shared/session/session';

export interface SessionUser {
  id: string;
  phone: string;
  fullName: string;
  roles: string[];
  permissions: string[];
}

export interface LoginPayload {
  phone: string;
  pin: string;
}

// The auth cache: `['auth', 'me']`. Every route that needs "am I logged
// in?" reads this query. The login mutation seeds it, the logout
// mutation clears it, and use401Redirect (P1-12) removes it on any 401.
// No other file writes to this key.

export function useSession() {
  return useQuery<SessionUser | null>({
    queryKey: AUTH_ME_KEY,
    queryFn: async () => {
      try {
        return await request<SessionUser>('/auth/me');
      } catch (err) {
        // A 401 already triggered the global redirect; return null so
        // the loading state resolves rather than retrying.
        if ((err as { status?: number })?.status === 401) return null;
        throw err;
      }
    },
    retry: false,
    staleTime: 30_000,
  });
}

export function useLoginMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      await request('/auth/login', { method: 'POST', body: payload });
    },
    onSuccess: () => {
      // Force the session query to refetch — the cookie is now set and
      // /auth/me will return the profile.
      qc.invalidateQueries({ queryKey: AUTH_ME_KEY });
    },
  });
}

export function useLogoutMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await request('/auth/logout', { method: 'POST' });
    },
    onSettled: () => {
      qc.setQueryData(AUTH_ME_KEY, null);
      qc.removeQueries({ queryKey: AUTH_ME_KEY });
    },
  });
}
