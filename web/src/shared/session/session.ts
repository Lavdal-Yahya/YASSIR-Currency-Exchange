import type { QueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_401_EVENT } from '../api/client';

// Any 401 from the API drops us to /login and clears the ['auth', 'me']
// cache so a stale session read doesn't briefly show authenticated UI
// on the way there. Mounted once, at the App level (see app/App.tsx).

export const AUTH_ME_KEY = ['auth', 'me'] as const;

export function use401Redirect(queryClient: QueryClient): void {
  const navigate = useNavigate();

  useEffect(() => {
    function onUnauthorized() {
      queryClient.setQueryData(AUTH_ME_KEY, null);
      queryClient.removeQueries({ queryKey: AUTH_ME_KEY });
      navigate('/login', { replace: true });
    }
    window.addEventListener(API_401_EVENT, onUnauthorized);
    return () => window.removeEventListener(API_401_EVENT, onUnauthorized);
  }, [queryClient, navigate]);
}
