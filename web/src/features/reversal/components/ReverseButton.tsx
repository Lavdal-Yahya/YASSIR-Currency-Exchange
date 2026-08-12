import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '../../auth/api/useSession';
import type { PermissionCode } from '../../../shared/permissions';
import { ReversalDialog } from './ReversalDialog';

// ReverseButton — small trigger that renders only when the current
// session holds the given permission. Opens the ReversalDialog and
// dispatches to the provided mutator. Consumer handles the mutator's
// success side effects (toast, navigate, etc).
//
// The button rendering is a courtesy — the server is authoritative,
// so hiding the button never enforces anything. When permission is
// absent, the whole component is unrendered so the operator's UI stays
// clean.

export interface ReverseButtonProps {
  permission: PermissionCode;
  dialogTitle: string;
  buttonLabel?: string;
  warnMessage?: string;
  disabled?: boolean;
  isPending: boolean;
  errorMessage?: string;
  onConfirm: (reason: string) => void;
  onClose?: () => void;
}

export function ReverseButton({
  permission,
  dialogTitle,
  buttonLabel,
  warnMessage,
  disabled,
  isPending,
  errorMessage,
  onConfirm,
  onClose,
}: ReverseButtonProps) {
  const { t } = useTranslation();
  const session = useSession();
  const [open, setOpen] = useState(false);
  if (!session.data?.permissions.includes(permission)) return null;
  return (
    <>
      <button
        type="button"
        className="btn btn--danger"
        disabled={disabled || isPending}
        onClick={() => setOpen(true)}
      >
        {buttonLabel ?? t('reversal.button')}
      </button>
      <ReversalDialog
        open={open}
        title={dialogTitle}
        warnMessage={warnMessage}
        isSubmitting={isPending}
        errorMessage={errorMessage}
        onCancel={() => {
          setOpen(false);
          onClose?.();
        }}
        onConfirm={(reason) => onConfirm(reason)}
      />
    </>
  );
}
