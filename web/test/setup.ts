import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
// Initializes react-i18next side-effectfully with fr as default. Every
// component that calls useTranslation() during a test resolves keys
// through this instance.
import '../src/shared/i18n/i18n';

// React 19 refuses to run inside `act(...)` unless this flag is set —
// otherwise every test using state updates prints a "not configured to
// support act" warning. Setting it globally matches how testing-library
// itself expects to run under Vitest/jsdom.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Testing Library's built-in auto-cleanup relies on a *global* `afterEach`
// (see @testing-library/react/dist/pure.js). We keep `globals: false` for
// the same reason the API side does — explicit imports keep tests
// self-documenting — so cleanup is wired here instead.
afterEach(() => {
  cleanup();
});
