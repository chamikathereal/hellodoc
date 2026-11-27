import { useEffect, useState } from 'react';
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
import { ApiError } from '@/lib/api';
import type { ScheduleTemplate } from '@/lib/clinic-types';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Mirrors the API rule: every booked patient must fit within the session time. */
function validate(template: ScheduleTemplate, capacity: number, duration: number): string | null {
  if (!Number.isInteger(capacity) || capacity < 1) return 'Capacity must be a whole number of at least 1';
  if (capacity > 500) return 'Capacity cannot be more than 500';
  if (!Number.isInteger(duration) || duration < 1) {
    return 'Duration must be a whole number of at least 1 minute';
  }
  if (duration > 240) return 'Duration cannot be more than 240 minutes';
  const sessionMinutes = toMinutes(template.localEndTime) - toMinutes(template.localStartTime);
  if (duration > sessionMinutes) {
    return `Duration (${duration} min) cannot be longer than the session (${sessionMinutes} min)`;
  }
  if (capacity * duration > sessionMinutes) {
    const maxCapacity = Math.floor(sessionMinutes / duration);
    return (
      `${capacity} patients × ${duration} min = ${capacity * duration} min, but the session is only ` +
      `${sessionMinutes} min. Reduce capacity to ${maxCapacity} or less, or shorten the duration.`
    );
  }
  return null;
}

/**
 * Updates capacity and duration for a weekly schedule template and all of its upcoming
 * scheduled sessions in one action.
 */
export function ScheduleTemplateBulkUpdateDialog({
  template,
  templateLabel,
  onOpenChange,
  onConfirm,
}: {
  template: ScheduleTemplate | null;
  templateLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (capacity: number, expectedDurationMinutes: number) => Promise<void>;
}) {
  const [capacity, setCapacity] = useState(20);
  const [duration, setDuration] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!template) return;
    setCapacity(template.defaultCapacity);
    setDuration(template.expectedDurationMinutes);
    setError(null);
  }, [template]);

  return (
    <Dialog
      open={template !== null}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk update sessions</DialogTitle>
          <DialogDescription>
            Set a new capacity and duration for the {templateLabel} schedule. All upcoming scheduled
            sessions generated from it are updated, and sessions generated later use the new values.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bulk-capacity">Capacity</Label>
            <Input
              id="bulk-capacity"
              type="number"
              min={1}
              max={500}
              step={1}
              value={Number.isNaN(capacity) ? '' : capacity}
              onChange={(e) => {
                setCapacity(e.target.value === '' ? Number.NaN : Number(e.target.value));
                setError(null);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-duration">Duration (min)</Label>
            <Input
              id="bulk-duration"
              type="number"
              min={1}
              max={240}
              step={1}
              value={Number.isNaN(duration) ? '' : duration}
              onChange={(e) => {
                setDuration(e.target.value === '' ? Number.NaN : Number(e.target.value));
                setError(null);
              }}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Sessions that already have more bookings than the new capacity, or whose time was changed so
          the new values no longer fit, are left unchanged.
        </p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (!template) return;
              const validationError = validate(template, capacity, duration);
              setError(validationError);
              if (validationError) return;
              setBusy(true);
              try {
                await onConfirm(capacity, duration);
                onOpenChange(false);
              } catch (err) {
                setError(err instanceof ApiError || err instanceof Error ? err.message : 'Bulk update failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Updating…' : 'Update sessions'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
