import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';

/** Confirms deactivation of a weekly schedule template and requires a reason. */
export function ScheduleTemplateDeactivateDialog({
  open,
  onOpenChange,
  templateLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateLabel: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    onOpenChange(false);
    setReason('');
    setError(null);
  };

  const trimmed = reason.trim();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (next) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Deactivate weekly schedule</DialogTitle>
          <DialogDescription>
            Deactivate the {templateLabel} schedule. Upcoming sessions from this schedule that have no
            bookings will be cancelled. Sessions with bookings are kept for you to review.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="template-deactivate-reason">
            Reason for deactivation <span className="text-destructive">*</span>
          </Label>
          <textarea
            id="template-deactivate-reason"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            value={reason}
            maxLength={500}
            onChange={(e) => {
              setReason(e.target.value);
              setError(null);
            }}
            placeholder="Required. At least 3 characters."
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={close}>
            Keep schedule
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || trimmed.length < 3}
            onClick={async () => {
              if (trimmed.length < 3) {
                setError('Enter a reason for deactivation (at least 3 characters)');
                return;
              }
              setBusy(true);
              setError(null);
              try {
                await onConfirm(trimmed);
                close();
              } catch (err) {
                setError(err instanceof ApiError || err instanceof Error ? err.message : 'Deactivation failed');
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Deactivating…' : 'Deactivate'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
