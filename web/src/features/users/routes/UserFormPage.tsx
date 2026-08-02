import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import { Loading } from '../../../shared/ui/Loading';
import { PageHeader } from '../../../shared/ui/PageHeader';
import {
  useCreateUser,
  useDeactivateUser,
  useReactivateUser,
  useResetUserPin,
  useSetUserRoles,
  useUpdateUser,
  useUser,
} from '../api/useUsers';

const createSchema = z.object({
  fullName: z.string().trim().min(1, { message: 'form.required' }).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{6,15}$/, { message: 'form.phone_invalid' }),
  pin: z.string().regex(/^\d{4,8}$/, { message: 'form.pin_invalid' }),
  isOwner: z.boolean(),
  isEmployee: z.boolean(),
});

const editSchema = z.object({
  fullName: z.string().trim().min(1, { message: 'form.required' }).max(120),
  isOwner: z.boolean(),
  isEmployee: z.boolean(),
});

type CreateFormValues = z.infer<typeof createSchema>;
type EditFormValues = z.infer<typeof editSchema>;

function rolesFrom(v: { isOwner: boolean; isEmployee: boolean }): string[] {
  const roles: string[] = [];
  if (v.isOwner) roles.push('OWNER');
  if (v.isEmployee) roles.push('EMPLOYEE');
  return roles;
}

export function UserFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  return id ? <EditForm id={id} /> : <CreateForm onCreated={() => navigate('/users')} />;
}

function CreateForm({ onCreated }: { onCreated: () => void }) {
  const { t } = useTranslation();
  const create = useCreateUser();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateFormValues>({
    resolver: zodResolver(createSchema),
    defaultValues: { fullName: '', phone: '', pin: '', isOwner: false, isEmployee: true },
  });

  async function onSubmit(values: CreateFormValues) {
    try {
      await create.mutateAsync({
        fullName: values.fullName,
        phone: values.phone,
        pin: values.pin,
        roles: rolesFrom(values),
      });
      onCreated();
    } catch {
      /* error surfaced below */
    }
  }

  return (
    <>
      <PageHeader title={t('users.new')} />
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="uf-name">{t('users.full_name')}</label>
          <input id="uf-name" {...register('fullName')} aria-invalid={!!errors.fullName} />
          {errors.fullName ? (
            <p className="field__error">{t(errors.fullName.message ?? 'form.required')}</p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="uf-phone">{t('users.phone')}</label>
          <input
            id="uf-phone"
            {...register('phone')}
            inputMode="tel"
            aria-invalid={!!errors.phone}
            placeholder="+222…"
          />
          {errors.phone ? (
            <p className="field__error">{t(errors.phone.message ?? 'form.phone_invalid')}</p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="uf-pin">{t('users.pin')}</label>
          <input id="uf-pin" {...register('pin')} inputMode="numeric" aria-invalid={!!errors.pin} />
          <p className="field__hint">{t('users.pin_hint')}</p>
          {errors.pin ? (
            <p className="field__error">{t(errors.pin.message ?? 'form.pin_invalid')}</p>
          ) : null}
        </div>
        <fieldset className="stack">
          <legend className="section-label">{t('users.roles')}</legend>
          <label className="checkbox-row">
            <input type="checkbox" {...register('isOwner')} />
            {t('users.role_owner')}
          </label>
          <label className="checkbox-row">
            <input type="checkbox" {...register('isEmployee')} />
            {t('users.role_employee')}
          </label>
        </fieldset>
        {create.error ? <ErrorMessage error={create.error} /> : null}
        <div className="dialog__actions">
          <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
            {t('common.create')}
          </button>
        </div>
      </form>
    </>
  );
}

function EditForm({ id }: { id: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const q = useUser(id);
  const update = useUpdateUser(id);
  const setRoles = useSetUserRoles(id);
  const deactivate = useDeactivateUser(id);
  const reactivate = useReactivateUser(id);
  const resetPin = useResetUserPin(id);
  const [newPin, setNewPin] = useState('');

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<EditFormValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { fullName: '', isOwner: false, isEmployee: true },
  });

  useEffect(() => {
    if (q.data) {
      reset({
        fullName: q.data.fullName,
        isOwner: q.data.roles.includes('OWNER'),
        isEmployee: q.data.roles.includes('EMPLOYEE'),
      });
    }
  }, [q.data, reset]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorMessage error={q.error} />;
  if (!q.data) return null;
  const u = q.data;

  async function onSubmit(values: EditFormValues) {
    try {
      if (values.fullName !== u.fullName) {
        await update.mutateAsync({ fullName: values.fullName });
      }
      const nextRoles = rolesFrom(values).sort();
      const prevRoles = [...u.roles].sort();
      const changed =
        nextRoles.length !== prevRoles.length || nextRoles.some((r, i) => r !== prevRoles[i]);
      if (changed) await setRoles.mutateAsync(nextRoles);
      navigate('/users');
    } catch {
      /* surfaced below */
    }
  }

  const mutationError =
    update.error ?? setRoles.error ?? deactivate.error ?? reactivate.error ?? resetPin.error;

  return (
    <>
      <PageHeader title={t('users.edit')} />
      <form className="stack" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="field">
          <label htmlFor="uf-name">{t('users.full_name')}</label>
          <input id="uf-name" {...register('fullName')} aria-invalid={!!errors.fullName} />
        </div>
        <div className="field">
          <label>{t('users.phone')}</label>
          <input value={u.phone} readOnly />
        </div>
        <fieldset className="stack">
          <legend className="section-label">{t('users.roles')}</legend>
          <label className="checkbox-row">
            <input type="checkbox" {...register('isOwner')} />
            {t('users.role_owner')}
          </label>
          <label className="checkbox-row">
            <input type="checkbox" {...register('isEmployee')} />
            {t('users.role_employee')}
          </label>
        </fieldset>
        {mutationError ? <ErrorMessage error={mutationError} /> : null}
        <div className="dialog__actions">
          <button type="submit" className="btn btn--primary" disabled={isSubmitting}>
            {t('common.save')}
          </button>
        </div>
      </form>

      <section className="profile-actions stack">
        <div className="field">
          <label htmlFor="uf-newpin">{t('users.reset_pin_new')}</label>
          <input
            id="uf-newpin"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            inputMode="numeric"
            placeholder="1234"
          />
          <button
            type="button"
            className="btn btn--secondary"
            onClick={async () => {
              await resetPin.mutateAsync(newPin);
              setNewPin('');
            }}
            disabled={!/^\d{4,8}$/.test(newPin) || resetPin.isPending}
          >
            {t('users.reset_pin')}
          </button>
        </div>

        {u.isActive ? (
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => deactivate.mutate()}
            disabled={deactivate.isPending}
          >
            {t('users.deactivate')}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => reactivate.mutate()}
            disabled={reactivate.isPending}
          >
            {t('users.reactivate')}
          </button>
        )}
      </section>
    </>
  );
}
