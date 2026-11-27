import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import { CatalogCombobox } from '@/components/catalog-combobox';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { api, ApiError } from '@/lib/api';
import { isSriLankanMobile, SRI_LANKA_MOBILE_HINT, SRI_LANKA_MOBILE_MESSAGE } from '@/lib/phone';
import { notify } from '@/lib/notify';
import type { Doctor } from '@/lib/clinic-types';

const schema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, 'Full name must be at least 2 characters')
    .max(120, 'Full name must be 120 characters or fewer'),
  displayName: z.string().trim().max(120, 'Display name must be 120 characters or fewer').optional(),
  specializationId: z.string().uuid('Select a specialization'),
  qualificationId: z.string().uuid('Select a qualification'),
  contactNumber: z
    .string()
    .trim()
    .refine((v) => v === '' || isSriLankanMobile(v), SRI_LANKA_MOBILE_MESSAGE)
    .optional(),
  email: z.string().trim().email('Enter a valid email address').optional().or(z.literal('')),
  confirmDuplicate: z.boolean().optional(),
});

type FormValues = z.infer<typeof schema>;

export function DoctorFormDialog({
  open,
  onOpenChange,
  doctorId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctorId?: string | null;
  onSaved?: (doctor: Doctor) => void;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const isEdit = Boolean(doctorId);
  const [version, setVersion] = useState<number | null>(null);
  const [registrationNumber, setRegistrationNumber] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [duplicatePrompt, setDuplicatePrompt] = useState(false);
  const [specName, setSpecName] = useState('');
  const [qualName, setQualName] = useState('');
  const [loadingDoctor, setLoadingDoctor] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      fullName: '',
      displayName: '',
      specializationId: '',
      qualificationId: '',
      contactNumber: '',
      email: '',
      confirmDuplicate: false,
    },
  });

  useEffect(() => {
    if (!open) return;
    setServerError(null);
    setDuplicatePrompt(false);

    if (!doctorId) {
      setVersion(null);
      setRegistrationNumber(null);
      setSpecName('');
      setQualName('');
      form.reset({
        fullName: '',
        displayName: '',
        specializationId: '',
        qualificationId: '',
        contactNumber: '',
        email: '',
        confirmDuplicate: false,
      });
      return;
    }

    setLoadingDoctor(true);
    api<Doctor>(`/clinic/doctors/${doctorId}`)
      .then((doctor) => {
        setVersion(doctor.version);
        setRegistrationNumber(doctor.registrationNumber);
        setSpecName(doctor.specialization ?? '');
        setQualName(doctor.qualifications ?? '');
        form.reset({
          fullName: doctor.fullName,
          displayName: doctor.displayName,
          specializationId: doctor.specializationId ?? '',
          qualificationId: doctor.qualificationId ?? '',
          contactNumber: doctor.contactNumber ?? '',
          email: doctor.email ?? '',
          confirmDuplicate: false,
        });
      })
      .catch((err) =>
        setServerError(err instanceof ApiError ? err.message : 'Doctor not found'),
      )
      .finally(() => setLoadingDoctor(false));
  }, [open, doctorId, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    const payload = {
      ...values,
      displayName: values.displayName || values.fullName,
      email: values.email || undefined,
      contactNumber: values.contactNumber || undefined,
      confirmDuplicate: values.confirmDuplicate || duplicatePrompt,
    };
    try {
      let saved: Doctor;
      if (isEdit) {
        if (version == null) throw new Error('Missing version');
        if (!values.specializationId || !values.qualificationId) {
          const message = 'Specialization and qualification are required';
          setServerError(message);
          notify.validation(message);
          return;
        }
        // confirmDuplicate is create-only; the update API rejects it.
        const { confirmDuplicate: _confirmDuplicate, ...editable } = payload;
        saved = await api<Doctor>(`/clinic/doctors/${doctorId}`, {
          method: 'PATCH',
          json: { ...editable, version },
        });
      } else {
        saved = await api<Doctor>('/clinic/doctors', { method: 'POST', json: payload });
      }
      onOpenChange(false);
      onSaved?.(saved);
      navigate(`/doctors/${saved.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.message.toLowerCase().includes('similar doctor')) {
        setDuplicatePrompt(true);
        form.setValue('confirmDuplicate', true);
      }
      setServerError(err instanceof ApiError ? err.message : 'Save failed');
    }
  }, (errors) => notify.formErrors(errors));

  const formBody = (
    <form id="doctor-form-dialog" className="space-y-4" onSubmit={onSubmit} noValidate>
      {loadingDoctor ? (
        <p className="text-sm text-muted-foreground">Loading doctor…</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="doctor-fullName">Full name</Label>
            <Input id="doctor-fullName" {...form.register('fullName')} />
            {form.formState.errors.fullName ? (
              <p className="text-xs text-destructive">{form.formState.errors.fullName.message}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doctor-displayName">Display name</Label>
            <Input id="doctor-displayName" {...form.register('displayName')} />
            {form.formState.errors.displayName ? (
              <p className="text-xs text-destructive">{form.formState.errors.displayName.message}</p>
            ) : null}
          </div>
          {isEdit ? (
            <div className="space-y-1.5">
              <Label>Registration number</Label>
              <Input value={registrationNumber ?? ''} readOnly disabled />
            </div>
          ) : null}
          <CatalogCombobox
            label="Specialization"
            kind="specializations"
            value={form.watch('specializationId')}
            selectedName={specName}
            onChange={(idValue, name) => {
              form.setValue('specializationId', idValue, { shouldValidate: true });
              setSpecName(name);
            }}
            error={form.formState.errors.specializationId?.message}
          />
          <CatalogCombobox
            label="Qualifications"
            kind="qualifications"
            value={form.watch('qualificationId')}
            selectedName={qualName}
            onChange={(idValue, name) => {
              form.setValue('qualificationId', idValue, { shouldValidate: true });
              setQualName(name);
            }}
            error={form.formState.errors.qualificationId?.message}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="doctor-phone">Phone</Label>
              <Input
                id="doctor-phone"
                type="tel"
                placeholder={SRI_LANKA_MOBILE_HINT}
                {...form.register('contactNumber')}
              />
              {form.formState.errors.contactNumber ? (
                <p className="text-xs text-destructive">{form.formState.errors.contactNumber.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doctor-email">Email</Label>
              <Input id="doctor-email" type="email" {...form.register('email')} />
              {form.formState.errors.email ? (
                <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
              ) : null}
            </div>
          </div>
          {duplicatePrompt ? (
            <p className="rounded-lg border border-amber-200/80 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              A similar doctor may already exist. Click Save again to confirm creating another
              record.
            </p>
          ) : null}
          {serverError ? <p className="text-sm text-destructive">{serverError}</p> : null}
        </>
      )}
    </form>
  );

  const actions = (
    <>
      <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button
        type="submit"
        form="doctor-form-dialog"
        disabled={form.formState.isSubmitting || loadingDoctor}
      >
        {form.formState.isSubmitting ? 'Saving…' : 'Save Doctor'}
      </Button>
    </>
  );

  const title = isEdit ? 'Edit doctor' : 'Add doctor';
  const description =
    'Registration numbers are generated automatically. Specialization and qualifications come from the global HelloDoc catalog.';

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex max-h-[92vh] flex-col gap-0 p-0">
          <SheetHeader className="px-5 py-4 text-left">
            <SheetTitle>{title}</SheetTitle>
            <SheetDescription>{description}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4">{formBody}</div>
          <SheetFooter className="px-5 py-4 sm:flex-row">
            {actions}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="px-6 pt-6 pb-2 text-left">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-2">{formBody}</div>
        <DialogFooter className="px-6 pt-2 pb-6">{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
