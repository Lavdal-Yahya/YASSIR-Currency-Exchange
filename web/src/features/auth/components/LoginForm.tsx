import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ApiError } from '../../../shared/api/error';
import { useLoginMutation, type LoginPayload } from '../api/useSession';

// Phone: E.164-ish with a lenient upper bound so the form doesn't reject
// legitimate international numbers we haven't seen yet. The server is
// the source of truth on shape.
// PIN: 4 digits in v1 (matches the seed). Complexity policy is out of
// scope for P1 (phase-1.md §8).
const schema = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{6,15}$/, { message: 'form.phone_invalid' }),
  pin: z.string().regex(/^\d{4,8}$/, { message: 'form.pin_invalid' }),
});

type FormValues = z.infer<typeof schema>;

export interface LoginFormProps {
  onSuccess?: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const { t } = useTranslation();
  const login = useLoginMutation();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { phone: '', pin: '' },
    mode: 'onSubmit',
  });

  async function onSubmit(values: FormValues) {
    try {
      await login.mutateAsync(values satisfies LoginPayload);
      onSuccess?.();
    } catch {
      // The error is exposed via `login.error` below; nothing to do here
      // beyond keeping the submit button re-enabled (react-hook-form
      // handles the isSubmitting flag automatically).
    }
  }

  const serverError = login.error instanceof ApiError ? login.error : null;
  const serverMessage = serverError
    ? t(serverError.i18nKey, { defaultValue: t('errors.unknown') })
    : null;

  const submitting = isSubmitting || login.isPending;

  return (
    <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div className="field">
        <label htmlFor="phone">{t('auth.phone')}</label>
        <input
          id="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+222…"
          disabled={submitting}
          aria-invalid={errors.phone ? 'true' : 'false'}
          {...register('phone')}
        />
        {errors.phone && (
          <p className="field__error" role="alert">
            {t(errors.phone.message ?? 'form.phone_invalid', {
              defaultValue: t('errors.validation'),
            })}
          </p>
        )}
      </div>

      <div className="field">
        <label htmlFor="pin">{t('auth.pin')}</label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          maxLength={8}
          disabled={submitting}
          aria-invalid={errors.pin ? 'true' : 'false'}
          {...register('pin')}
        />
        {errors.pin && (
          <p className="field__error" role="alert">
            {t(errors.pin.message ?? 'form.pin_invalid', {
              defaultValue: t('errors.validation'),
            })}
          </p>
        )}
      </div>

      {serverMessage && (
        <p className="form__error" role="alert">
          {serverMessage}
        </p>
      )}

      <button type="submit" className="btn btn--primary" disabled={submitting}>
        {submitting ? t('common.loading') : t('auth.submit')}
      </button>
    </form>
  );
}
