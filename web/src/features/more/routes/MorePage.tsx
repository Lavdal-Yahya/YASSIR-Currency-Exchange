import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { isVisible, MORE_GROUPS } from '../../../app/nav-config';
import { PageHeader } from '../../../shared/ui/PageHeader';
import { usePermissions } from '../../../shared/session/usePermissions';

// The `More` menu — the fifth tab slot. Everything that is not a tab and
// not a daily create action lives here, grouped.
//
// This is also the fix for four screens that had no inbound link
// anywhere in the app: /expenses, /currencies, /users and /payments were
// reachable only by typing the URL.
//
// Groups whose every entry is filtered out by permission are not
// rendered at all — no empty headings.

export function MorePage() {
  const { t } = useTranslation();
  const { has } = usePermissions();

  const groups = MORE_GROUPS.map((group) => ({
    labelKey: group.labelKey,
    entries: group.entries.filter((entry) => isVisible(entry, has)),
  })).filter((group) => group.entries.length > 0);

  return (
    <>
      <PageHeader title={t('nav.more')} />
      {groups.length === 0 ? <p className="empty-state">{t('nav.more_empty')}</p> : null}
      {groups.map((group) => (
        <section key={group.labelKey} className="more-group">
          <h2 className="section-label">{t(group.labelKey)}</h2>
          <ul className="more-list">
            {group.entries.map((entry) => (
              <li key={entry.to}>
                <Link to={entry.to} className="more-list__item">
                  <span aria-hidden="true" className="more-list__icon">
                    {entry.icon}
                  </span>
                  <span className="more-list__label">{t(entry.labelKey)}</span>
                  <span aria-hidden="true" className="more-list__chevron">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
