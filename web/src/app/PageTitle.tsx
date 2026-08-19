import { createContext, useContext, useEffect } from 'react';

// The screen title lives in the title bar (design handoff, "App chrome:
// Title bar — back chevron, title, language switcher"), but it is the
// *page* that knows what it is called — often dynamically, as with the
// contact profile rendering a contact's name.
//
// So the page keeps publishing its title through `<PageHeader title=…>`
// exactly as before, and PageHeader registers it here instead of
// rendering its own <h1>. The shell renders the single <h1> in the bar.
//
// Deliberately not derived from a route→title map: 32 pages already
// compute their own titles, several of them from loaded data.

type SetTitle = (title: string | null) => void;

const PageTitleContext = createContext<SetTitle | null>(null);

export const PageTitleProvider = PageTitleContext.Provider;

/**
 * Publish this screen's title to the title bar. Safe to call outside the
 * shell (the login screen has no title bar) — it is then a no-op.
 */
export function usePageTitle(title: string | null): void {
  const setTitle = useContext(PageTitleContext);
  useEffect(() => {
    if (!setTitle) return;
    setTitle(title);
    // No cleanup: clearing on unmount blanks the bar for a frame during
    // every navigation. The next screen's PageHeader overwrites it.
  }, [setTitle, title]);
}
