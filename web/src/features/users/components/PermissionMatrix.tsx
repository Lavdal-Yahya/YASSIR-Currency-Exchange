import { useTranslation } from 'react-i18next';
import {
  DEFAULT_EMPLOYEE_PERMISSIONS,
  DEFAULT_OWNER_PERMISSIONS,
  PERMISSION_GROUPS,
  type PermissionCode,
} from '../../../shared/permissions';

const ROLES: { code: 'OWNER' | 'EMPLOYEE'; labelKey: string; set: readonly PermissionCode[] }[] = [
  { code: 'OWNER', labelKey: 'users.role_owner', set: DEFAULT_OWNER_PERMISSIONS },
  { code: 'EMPLOYEE', labelKey: 'users.role_employee', set: DEFAULT_EMPLOYEE_PERMISSIONS },
];

// Read-only role × permission grid. Editing happens per-user via the
// user form; this is a documentation surface — "what does each role
// see?" — for the owner. The matrix reads from ../shared/permissions,
// so adding a permission code in that file lights up here automatically.
export function PermissionMatrix() {
  const { t } = useTranslation();
  return (
    <>
      <p className="page-lede">{t('settings.permissions.readonly_note')}</p>
      <table className="matrix">
        <thead>
          <tr>
            <th>{t('settings.permissions.role')}</th>
            {ROLES.map((r) => (
              <th key={r.code}>{t(r.labelKey)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_GROUPS.map((group) => (
            <>
              <tr key={`g-${group.label}`} className="matrix__group">
                <td colSpan={1 + ROLES.length}>{group.label.replace(/_/g, ' ')}</td>
              </tr>
              {group.codes.map((code) => (
                <tr key={code}>
                  <td>
                    <code>{code}</code>
                  </td>
                  {ROLES.map((r) => (
                    <td key={r.code} aria-label={r.code}>
                      {r.set.includes(code) ? '✓' : '·'}
                    </td>
                  ))}
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </>
  );
}
