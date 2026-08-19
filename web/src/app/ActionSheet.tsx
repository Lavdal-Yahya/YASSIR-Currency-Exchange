import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { usePermissions } from '../shared/session/usePermissions';
import { isVisible, QUICK_ACTIONS } from './nav-config';

// The action sheet behind the FAB — the five daily actions, in frequency
// order (design handoff: "the single most-used control in the product").
//
// Items are filtered by permission, not disabled: an employee without
// `expense:create` sees four items, not a greyed-out five.
//
// Dismissal: backdrop tap, Escape, or choosing an action. Focus moves to
// the first item on open and returns to the FAB on close, so the sheet
// is operable from a keyboard as well as a thumb.

export function ActionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { has } = usePermissions();
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    firstItemRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const actions = QUICK_ACTIONS.filter((action) => isVisible(action, has));

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={t('nav.actions')}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet__grip" aria-hidden="true" />
        {actions.length === 0 ? (
          <p className="sheet__empty">{t('nav.actions_none')}</p>
        ) : (
          <ul className="sheet__list">
            {actions.map((action, index) => (
              <li key={action.to}>
                <button
                  type="button"
                  ref={index === 0 ? firstItemRef : undefined}
                  className="sheet__item"
                  onClick={() => {
                    onClose();
                    navigate(action.to);
                  }}
                >
                  <span aria-hidden="true" className="sheet__icon">
                    {action.icon}
                  </span>
                  <span className="sheet__label">{t(action.labelKey)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="sheet__cancel" onClick={onClose}>
          {t('nav.cancel')}
        </button>
      </div>
    </div>
  );
}
