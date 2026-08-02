import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library's built-in auto-cleanup relies on a *global* `afterEach`
// (see @testing-library/react/dist/pure.js). We keep `globals: false` for
// the same reason the API side does — explicit imports keep tests
// self-documenting — so cleanup is wired here instead.
afterEach(() => {
  cleanup();
});
