import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { ApiError } from '../../../shared/api/error';
import { ErrorMessage } from '../../../shared/ui/ErrorMessage';
import type { Contact, ContactInput } from '../api/useContacts';
import { DuplicatePhoneDialog } from './DuplicatePhoneDialog';

const schema = z.object({
  name: z.string().trim().min(1, { message: 'form.required' }).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+\d{6,15}$/, { message: 'contacts.phone_invalid' })
    .optional()
    .or(z.literal('')),
  isCustomer: z.boolean(),
  isSupplier: z.boolean(),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
});

type FormValues = z.infer<typeof schema>;

interface Props {
  initial?: Contact;
  onSubmit: (input: ContactInput) => Promise<void>;
  onCancel: () => void;
  submitting?: boolean;
  error?: unknown;
}

// Contact create/edit form. The duplicate-phone dialog surfaces when
// the API rejects with 409 duplicate_phone; retrying with
// confirmDuplicate=true is handled here so the parent page just calls
// onSubmit(input) and doesn't have to know about the 2-step handshake.
export function ContactForm({ initial, onSubmit, onCancel, submitting, error }: Props) {
  const { t } = useTranslation();
  const [dupExisting, setDupExisting] = useState<{ name: string } | null>(null);
  const [pendingInput, setPendingInput] = useState<ContactInput | null>(null);
  const [confirming, setConfirming] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      phone: initial?.phone ?? '',
      isCustomer: initial?.isCustomer ?? true,
      isSupplier: initial?.isSupplier ?? false,
      notes: initial?.notes ?? '',
    },
  });

  async function submit(values: FormValues) {
    const input: ContactInput = {
      name: values.name,
      phone: values.phone && values.phone.length > 0 ? values.phone : null,
      isCustomer: values.isCustomer,
      isSupplier: values.isSupplier,
      notes: values.notes && values.notes.length > 0 ? values.notes : null,
    };
    try {
      await onSubmit(input);
    } catch (err) {
      if (
        err instanceof ApiError &&
        err.code === 'duplicate_phone' &&
        err.data &&
        typeof err.data.existing === 'object'
      ) {
        const existing = err.data.existing as { id: string; name: string };
        setPendingInput(input);
        setDupExisting({ name: existing.name });
      }
    }
  }

  async function confirmDuplicate() {
    if (!pendingInput) return;
    setConfirming(true);
    try {
      await onSubmit({ ...pendingInput, confirmDuplicate: true });
      setDupExisting(null);
      setPendingInput(null);
    } finally {
      setConfirming(false);
    }
  }

  const busy = submitting || isSubmitting;

  return (
    <>
      <form className="stack" onSubmit={handleSubmit(submit)} noValidate>
        <div className="field">
          <label htmlFor="ct-name">{t('contacts.name')}</label>
          <input id="ct-name" {...register('name')} aria-invalid={!!errors.name} />
          {errors.name ? (
            <p className="field__error">{t(errors.name.message ?? 'form.required')}</p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="ct-phone">{t('contacts.phone')}</label>
          <input
            id="ct-phone"
            {...register('phone')}
            inputMode="tel"
            aria-invalid={!!errors.phone}
            placeholder="+222…"
          />
          <p className="field__hint">{t('contacts.phone_optional')}</p>
          {errors.phone ? (
            <p className="field__error">{t(errors.phone.message ?? 'contacts.phone_invalid')}</p>
          ) : null}
        </div>

        <label className="checkbox-row">
          <input type="checkbox" {...register('isCustomer')} />
          {t('contacts.is_customer')}
        </label>
        <label className="checkbox-row">
          <input type="checkbox" {...register('isSupplier')} />
          {t('contacts.is_supplier')}
        </label>

        <div className="field">
          <label htmlFor="ct-notes">{t('contacts.notes')}</label>
          <textarea id="ct-notes" {...register('notes')} rows={4} />
          <p className="field__hint">{t('contacts.notes_hint')}</p>
        </div>

        {error ? <ErrorMessage error={error} /> : null}

        <div className="dialog__actions">
          <button type="button" className="btn btn--ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {t('common.save')}
          </button>
        </div>
      </form>

      {dupExisting ? (
        <DuplicatePhoneDialog
          existingName={dupExisting.name}
          onCancel={() => {
            setDupExisting(null);
            setPendingInput(null);
          }}
          onConfirm={confirmDuplicate}
          isConfirming={confirming}
        />
      ) : null}
    </>
  );
}
