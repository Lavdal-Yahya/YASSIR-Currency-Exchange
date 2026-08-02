import type { ReactNode } from 'react';

// A page's title bar. The optional `action` slot is where a primary
// action (usually a `+ new` button) lives — kept to one action so the
// mobile viewport stays uncrowded.
export function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <header className="page-header">
      <h1 className="page-title">{title}</h1>
      {action ?? null}
    </header>
  );
}
