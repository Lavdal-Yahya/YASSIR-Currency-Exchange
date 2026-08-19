import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSession } from '../features/auth/api/useSession';
import { LanguageSwitcher } from '../shared/i18n/LanguageSwitcher';
import { ROOT_PATHS } from './nav-config';

// Title bar — `--ink` chrome, min-block-size 52px (design handoff, "App
// chrome"). Back chevron, screen title, language switcher, user avatar.
//
// The chevron is `‹` and flips to `›` in RTL. It is absent on a root
// screen (the four tab destinations), because there is nothing above
// them to go back to.
//
// The language switcher lives here, on every screen, rather than three
// levels down in Settings → Profile: a user who cannot read the
// interface has to be able to change it from wherever they are. It is
// on the login screen for the same reason (LoginPage renders its own).

export function TitleBar({ title }: { title: string | null }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();

  const isRoot = ROOT_PATHS.has(location.pathname);
  const isRtl = i18n.dir() === 'rtl';

  return (
    <header className="title-bar">
      {isRoot ? null : (
        <button
          type="button"
          className="title-bar__back"
          onClick={() => navigate(-1)}
          aria-label={t('nav.back')}
        >
          <span aria-hidden="true">{isRtl ? '›' : '‹'}</span>
        </button>
      )}
      <h1 className="title-bar__title">{title ?? ''}</h1>
      <LanguageSwitcher compact />
      <UserAvatar />
    </header>
  );
}

/** Two-letter initials, Latin or Arabic — first letter of the first two words. */
function initialsOf(fullName: string): string {
  const words = fullName.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (words.length === 0) return '?';
  return words.map((w) => [...w][0] ?? '').join('');
}

function UserAvatar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const session = useSession();
  const user = session.data;
  if (!user) return null;

  // Owner gets the inverted fill — the design uses it to signal, at a
  // glance, which kind of account is looking at the screen.
  const isOwner = user.roles.includes('OWNER');

  return (
    <button
      type="button"
      className={`title-bar__avatar${isOwner ? ' title-bar__avatar--owner' : ''}`}
      onClick={() => navigate('/settings/profile')}
      aria-label={t('nav.profile_of', { name: user.fullName })}
    >
      <span aria-hidden="true">{initialsOf(user.fullName)}</span>
    </button>
  );
}
