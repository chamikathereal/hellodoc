import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
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
import { notify } from '@/lib/notify';
import type { ConsultationSession, Doctor } from '@/lib/clinic-types';
import { formatSessionDuration } from '../utils/session-formatters';

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

const schema = z
  .object({
    doctorId: z.string().uuid('Select a doctor'),
    localDate: z.string().min(1, 'Date is required'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/),
    endTime: z.string().regex(/^\d{2}:\d{2}$/),
    capacity: z
      .number({ error: 'Enter the maximum number of patients' })
      .int('Maximum patients must be a whole number')
      .min(1, 'Maximum patients must be at least 1')
      .max(500, 'Maximum patients cannot be more than 500'),
    expectedDurationMinutes: z
      .number({ error: 'Enter the expected consult time in minutes' })
      .int('Expected consult must be a whole number of minutes')
      .min(1, 'Expected consult must be at least 1 minute')
      .max(240, 'Expected consult cannot be more than 240 minutes'),
    location: z.string().max(120).optional(),
    internalNotes: z.string().max(1000).optional(),
  })
  .superRefine((v, ctx) => {
    // Mirrors the API rule: every patient's expected consult must fit within the session time.
    const sessionMinutes = hhmmToMinutes(v.endTime) - hhmmToMinutes(v.startTime);
    if (sessionMinutes <= 0) return;
    if (v.expectedDurationMinutes > sessionMinutes) {
      ctx.addIssue({
        code: 'custom',
        path: ['expectedDurationMinutes'],
        message: `Expected consult (${v.expectedDurationMinutes} min) cannot be longer than the session (${sessionMinutes} min)`,
      });
    } else if (v.capacity * v.expectedDurationMinutes > sessionMinutes) {
      const maxCapacity = Math.floor(sessionMinutes / v.expectedDurationMinutes);
      ctx.addIssue({
        code: 'custom',
        path: ['capacity'],
        message: `${v.capacity} patients × ${v.expectedDurationMinutes} min = ${v.capacity * v.expectedDurationMinutes} min, but the session is only ${sessionMinutes} min. Use ${maxCapacity} or fewer patients.`,
      });
    }
  });

type FormValues = z.infer<typeof schema>;

export type CreateSessionDefaults = {
  doctorId?: string;
  date?: string;
};

export function CreateSessionDialog({
  open,
  onOpenChange,
  defaults,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: CreateSessionDefaults;
  onCreated?: (session: ConsultationSession) => void;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      doctorId: '',
      localDate: '',
      startTime: '17:00',
      endTime: '21:00',
      capacity: 20,
      expectedDurationMinutes: 10,
      location: '',
      internalNotes: '',
    },
  });

  const startTime = form.watch('startTime');
  const endTime = form.watch('endTime');
  const localDate = form.watch('localDate');

  const durationLabel = useMemo(() => {
    if (!localDate || !startTime || !endTime) return '—';
    const startAt = new Date(`${localDate}T${startTime}:00`);
    const endAt = new Date(`${localDate}T${endTime}:00`);
    return formatSessionDuration(startAt.toISOString(), endAt.toISOString());
  }, [localDate, startTime, endTime]);

  useEffect(() => {
    if (!open) return;
    form.reset({
      doctorId: defaults?.doctorId ?? '',
      localDate: defaults?.date ?? '',
      startTime: '17:00',
      endTime: '21:00',
      capacity: 20,
      expectedDurationMinutes: 10,
      location: '',
      internalNotes: '',
    });
    setError(null);
    api<{ items: Doctor[] }>('/clinic/doctors?status=ACTIVE&limit=100')
      .then((data) => setDoctors(data.items))
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Failed to load doctors'),
      );
  }, [open, defaults?.doctorId, defaults?.date, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    const startLocal = new Date(`${values.localDate}T${values.startTime}:00+05:30`);
    const endLocal = new Date(`${values.localDate}T${values.endTime}:00+05:30`);
    if (Number.isNaN(startLocal.getTime()) || Number.isNaN(endLocal.getTime())) {
      const message = 'Enter a valid consultation date and time.';
      setError(message);
      notify.validation(message);
      return;
    }
    if (endLocal.getTime() <= startLocal.getTime()) {
      const message = 'End time must be after start time.';
      setError(message);
      notify.validation(message);
      return;
    }
    if (endLocal.getTime() <= Date.now()) {
      const message =
        'This session time has already ended in Asia/Colombo. Choose a later end time or date.';
      setError(message);
      notify.validation(message);
      return;
    }
    try {
      const created = await api<ConsultationSession>('/clinic/sessions', {
        method: 'POST',
        json: {
          ...values,
          location: values.location || undefined,
          internalNotes: values.internalNotes || undefined,
          timezone: 'Asia/Colombo',
        },
      });
      onOpenChange(false);
      onCreated?.(created);
      navigate(`/sessions?detail=${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create session');
    }
  }, (errors) => notify.formErrors(errors));

  const formBody = (
    <form id="create-session-form" className="space-y-5" onSubmit={onSubmit} noValidate>
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Doctor & date</h3>
          <p className="text-xs text-muted-foreground">Who is available and on which day</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Doctor</Label>
            <Select
              value={form.watch('doctorId') || undefined}
              onValueChange={(v) => form.setValue('doctorId', v, { shouldValidate: true })}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select doctor" />
              </SelectTrigger>
              <SelectContent>
                {doctors.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.displayName}
                    {d.specialization ? ` · ${d.specialization}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.formState.errors.doctorId ? (
              <p className="text-xs text-destructive">{form.formState.errors.doctorId.message}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-session-date">Consultation date</Label>
            <Input id="create-session-date" type="date" {...form.register('localDate')} />
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Time & availability</h3>
          <p className="text-xs text-muted-foreground">
            Asia/Colombo · duration calculated automatically
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="create-session-start">Start</Label>
            <Input id="create-session-start" type="time" {...form.register('startTime')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-session-end">End</Label>
            <Input id="create-session-end" type="time" {...form.register('endTime')} />
          </div>
          <div className="space-y-1.5">
            <Label>Session duration</Label>
            <Input value={durationLabel} readOnly disabled />
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Capacity</h3>
          <p className="text-xs text-muted-foreground">
            Maximum patients for this consultation period
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="create-session-capacity">Maximum patients</Label>
            <Input
              id="create-session-capacity"
              type="number"
              min={1}
              max={500}
              step={1}
              aria-invalid={Boolean(form.formState.errors.capacity)}
              {...form.register('capacity', { valueAsNumber: true })}
            />
            {form.formState.errors.capacity ? (
              <p className="text-xs text-destructive">{form.formState.errors.capacity.message}</p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="create-session-duration">Expected consult (min)</Label>
            <Input
              id="create-session-duration"
              type="number"
              min={1}
              max={240}
              step={1}
              aria-invalid={Boolean(form.formState.errors.expectedDurationMinutes)}
              {...form.register('expectedDurationMinutes', { valueAsNumber: true })}
            />
            {form.formState.errors.expectedDurationMinutes ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.expectedDurationMinutes.message}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <Separator />

      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Additional information</h3>
        <div className="space-y-1.5">
          <Label htmlFor="create-session-location">Location (optional)</Label>
          <Input id="create-session-location" {...form.register('location')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="create-session-notes">Internal notes (optional)</Label>
          <Input id="create-session-notes" {...form.register('internalNotes')} />
        </div>
      </section>

      {error ? (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </form>
  );

  const actions = (
    <>
      <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button type="submit" form="create-session-form" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting ? 'Creating…' : 'Create Session'}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex max-h-[92vh] flex-col gap-0 p-0">
          <SheetHeader className="px-5 py-4 text-left">
            <SheetTitle>Create session</SheetTitle>
            <SheetDescription>
              Define a consultation period. Patient bookings are not created here.
            </SheetDescription>
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
      <DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-2 text-left">
          <DialogTitle>Create session</DialogTitle>
          <DialogDescription>
            Define a consultation period. Patient bookings are not created here.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-2">{formBody}</div>
        <DialogFooter className="px-6 pt-2 pb-6">{actions}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
