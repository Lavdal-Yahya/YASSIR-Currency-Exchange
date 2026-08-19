import type { ReactNode } from 'react';
import { usePageTitle } from '../../app/PageTitle';

// A page's title + optional primary action.
//
// The title is published to the shell's title bar (see app/PageTitle.tsx)
// rather than rendered here — the design puts exactly one screen title on
// screen, in the chrome. The call site is unchanged: pages still pass
// `title`, including titles computed from loaded data.
//
// The action slot still renders in the body, right-aligned, so a list's
// "+ new" button stays next to the content it acts on.
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  usePageTitle(title);
  if (!action) return null;
  return <div className="page-header">{action}</div>;
}
