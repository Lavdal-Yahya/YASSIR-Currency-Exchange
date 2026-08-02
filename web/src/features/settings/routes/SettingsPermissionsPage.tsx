import { PermissionMatrix } from '../../users/components/PermissionMatrix';

// Thin wrapper — the matrix component owns the layout.
export function SettingsPermissionsPage() {
  return <PermissionMatrix />;
}
