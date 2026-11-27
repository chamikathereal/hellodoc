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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { notify } from '@/lib/notify';

export function SessionCancelDialog({
  open,
  onOpenChange,
  doctorName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  doctorName: string;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) {
          onOpenChange(next);
          if (!next) {
            setReason('');
            setError(null);
          }
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel consultation session</DialogTitle>
          <DialogDescription>
            Cancel the session for {doctorName}. This cannot be undone. All confirmed appointments in
            this session will be cancelled and the patients will be notified by SMS.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="cancel-reason">Cancellation reason</Label>
          <Input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required — at least 3 characters"
          />
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Keep session
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={busy || reason.trim().length < 3}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                onOpenChange(false);
                setReason('');
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Cancellation failed';
                setError(message);
                // ApiError from parent api() already toasted.
                if (!(err instanceof ApiError)) notify.error(message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Cancelling…' : 'Confirm cancellation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
