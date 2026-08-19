import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ActionSheet } from './ActionSheet';
import { BottomNav } from './BottomNav';
import { PageTitleProvider } from './PageTitle';
import { TitleBar } from './TitleBar';

// App chrome (design handoff, S-03): title bar, body, bottom tab bar,
// and the `+` action sheet.
//
// Three rows: `auto 1fr auto`. The body is the only scroll container, so
// both bars stay visible without either being `position: fixed` — which
// keeps them out of the way of the on-screen keyboard on a phone.
//
// The screen title is owned by the page (via PageHeader) and rendered
// here, once, in the bar. See PageTitle.tsx for why it is not a
// route→title map.

export function AppShell() {
  const [title, setTitle] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const location = useLocation();

  const closeActions = useCallback(() => setActionsOpen(false), []);
  const openActions = useCallback(() => setActionsOpen(true), []);

  // Each screen starts at the top. Scrolling the container beats keying
  // <main> on the pathname, which would remount the whole subtree and
  // discard state React Router had deliberately preserved.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    // `scrollTop`, not `scrollTo`: the property is universally supported
    // and, unlike the method, exists in jsdom.
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  return (
    <PageTitleProvider value={setTitle}>
      <div className="app-shell">
        <TitleBar title={title} />
        <main className="app-shell__main" ref={mainRef}>
          <Outlet />
        </main>
        <BottomNav onOpenActions={openActions} />
        <ActionSheet open={actionsOpen} onClose={closeActions} />
      </div>
    </PageTitleProvider>
  );
}
