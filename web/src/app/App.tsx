import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider, createBrowserRouter } from 'react-router-dom';
import { routes } from './routes';

// One router, one query client, both created at module init. Cache keys are
// declared per-feature (conventions §4) — no global cache defaults beyond
// what react-query already provides.
const router = createBrowserRouter(routes);

export function App() {
  // Held in state so React fast-refresh doesn't dispose the cache on every
  // edit during development.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
