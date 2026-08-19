import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { usePermissions } from '../shared/session/usePermissions';
import { isVisible, TAB_ITEMS } from './nav-config';

// Bottom tab bar — five slots: four destinations plus the FAB in the
// centre. Bottom, not top: the app is used standing up and one-handed
// (design handoff, "Context of use"), so the primary navigation has to
// sit in thumb reach.
//
// Grid is `1fr 1fr 76px 1fr 1fr` with the FAB overhanging the top edge.
// Tracks are `minmax(0, …)` in CSS so a long French or Arabic label
// ellipsises instead of widening the bar past the viewport.
//
// Items filter on permission, matching what the dashboard already does
// for its links — an employee should not be shown a tab that answers
// with 403.

export function BottomNav({ onOpenActions }: { onOpenActions: () => void }) {
  const { t } = useTranslation();
  const { has } = usePermissions();

  const visible = TAB_ITEMS.filter((item) => isVisible(item, has));
  // The FAB sits between the second and third visible destination.
  const split = Math.ceil(visible.length / 2);

  return (
    <nav className="bottom-nav" aria-label={t('nav.primary')}>
      {visible.slice(0, split).map((item) => (
        <TabLink
          key={item.to}
          to={item.to}
          end={item.end}
          icon={item.icon}
          label={t(item.labelKey)}
        />
      ))}

      <button
        type="button"
        className="bottom-nav__fab"
        onClick={onOpenActions}
        aria-label={t('nav.actions')}
      >
        <span aria-hidden="true">+</span>
      </button>

      {visible.slice(split).map((item) => (
        <TabLink
          key={item.to}
          to={item.to}
          end={item.end}
          icon={item.icon}
          label={t(item.labelKey)}
        />
      ))}
    </nav>
  );
}

function TabLink({
  to,
  end,
  icon,
  label,
}: {
  to: string;
  end?: boolean;
  icon: string;
  label: string;
}) {
  return (
    <NavLink to={to} end={end} className="bottom-nav__item">
      <span aria-hidden="true" className="bottom-nav__icon">
        {icon}
      </span>
      <span className="bottom-nav__label">{label}</span>
    </NavLink>
  );
}
