import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/error';

// Translates an error from a hook into a user-facing string. Falls back
// to a generic "unknown" copy if the shape is unfamiliar.
export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const message =
    error instanceof ApiError
      ? t(error.i18nKey, { defaultValue: t('errors.unknown') })
      : t('errors.unknown');
  return (
    <p className="form__error" role="alert">
      {message}
    </p>
  );
}
