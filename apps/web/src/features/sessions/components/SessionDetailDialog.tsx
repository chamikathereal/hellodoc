import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Calendar,
  Clock,
  MapPin,
  Pencil,
  Stethoscope,
  Users,
} from 'lucide-react';
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
import { Skeleton } from '@/components/ui/skeleton';
import { SessionCancelDialog } from './SessionCancelDialog';
import { SessionStatusBadge } from './SessionStatusBadge';
import {
  formatSessionDate,
  formatSessionDuration,
  formatSessionTime,
} from '../utils/session-formatters';
import { canModifySession } from '../utils/session-status';
import { api, ApiError } from '@/lib/api';
import type { ConsultationSession } from '@/lib/clinic-types';
import { formatClinicDateTime } from '@/lib/visit-timings';

export function SessionDetailDialog({
  open,
  onOpenChange,
  sessionId,
  initialEdit = false,
  onUpdated,
  onBookAppointment,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string | null;
  initialEdit?: boolean;
  onUpdated?: () => void;
  onBookAppointment?: (session: ConsultationSession) => void;
}) {
  const navigate = useNavigate();
  const [session, setSession] = useState<ConsultationSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(initialEdit);
  const [cancelOpen, setCancelOpen] = useState(false);

  // Edit fields
  const [localDate, setLocalDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [capacity, setCapacity] = useState(20);
  const [duration, setDuration] = useState(10);
  const [location, setLocation] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEditing(initialEdit);
  }, [initialEdit, open]);

  useEffect(() => {
    if (!open || !sessionId) {
      setSession(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    api<ConsultationSession>(`/clinic/sessions/${sessionId}`)
      .then((data) => {
        if (cancelled) return;
        setSession(data);
        setLocalDate(data.localDate);
        setStartTime(
          new Date(data.startAt).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: data.timezone || 'Asia/Colombo',
          }),
        );
        setEndTime(
          new Date(data.endAt).toLocaleTimeString('en-GB', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone: data.timezone || 'Asia/Colombo',
          }),
        );
        setCapacity(data.capacity);
        setDuration(data.expectedDurationMinutes);
        setLocation(data.location ?? '');
        setInternalNotes(data.internalNotes ?? '');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Session not found');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, sessionId]);

  const canEdit = session ? canModifySession(session.status, session.startAt) : false;

  const handleSave = async () => {
    if (!session) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api<ConsultationSession>(`/clinic/sessions/${session.id}`, {
        method: 'PATCH',
        json: {
          localDate,
          startTime,
          endTime,
          capacity,
          expectedDurationMinutes: duration,
          location: location.trim() || undefined,
          internalNotes: internalNotes.trim() || undefined,
          version: session.version,
        },
      });
      setSession(updated);
      setEditing(false);
      onUpdated?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex flex-wrap items-center justify-between gap-2 pr-6">
              <DialogTitle className="text-lg font-semibold">
                {editing ? 'Edit Session' : 'Session Detail'}
              </DialogTitle>
              {session ? <SessionStatusBadge status={session.status} /> : null}
            </div>
            <DialogDescription>
              {session?.doctorDisplayName ?? 'Consultation session details and controls'}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="space-y-4 py-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : error && !session ? (
            <div className="py-6 text-center text-sm text-destructive">{error}</div>
          ) : session ? (
            <div className="space-y-5 py-2">
              {error ? (
                <div className="rounded-md border border-destructive/20 bg-destructive/10 p-3 text-xs text-destructive">
                  {error}
                </div>
              ) : null}

              {editing ? (
                /* Edit Mode */
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-date">Date</Label>
                      <Input
                        id="edit-date"
                        type="date"
                        value={localDate}
                        onChange={(e) => setLocalDate(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-start">Start Time</Label>
                      <Input
                        id="edit-start"
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-end">End Time</Label>
                      <Input
                        id="edit-end"
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-cap">Max Capacity</Label>
                      <Input
                        id="edit-cap"
                        type="number"
                        min={1}
                        max={500}
                        value={capacity}
                        onChange={(e) => setCapacity(Number(e.target.value))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-duration">Expected Consult (min)</Label>
                      <Input
                        id="edit-duration"
                        type="number"
                        min={1}
                        max={240}
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="edit-location">Location / Room</Label>
                    <Input
                      id="edit-location"
                      placeholder="e.g. Room 1"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="edit-notes">Internal Notes</Label>
                    <Input
                      id="edit-notes"
                      placeholder="Optional notes for staff"
                      value={internalNotes}
                      onChange={(e) => setInternalNotes(e.target.value)}
                    />
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setEditing(false);
                        setError(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="button" disabled={busy} onClick={handleSave}>
                      {busy ? 'Saving…' : 'Save Changes'}
                    </Button>
                  </div>
                </div>
              ) : (
                /* View Mode */
                <div className="space-y-4">
                  <div className="grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-2">
                    <div>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Stethoscope className="size-3.5" /> Doctor
                      </span>
                      <p className="mt-0.5 font-medium">{session.doctorDisplayName}</p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Calendar className="size-3.5" /> Date
                      </span>
                      <p className="mt-0.5 font-medium">
                        {formatSessionDate(session.localDate, session.timezone)}
                      </p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="size-3.5" /> Time & Duration
                      </span>
                      <p className="mt-0.5 font-medium">
                        {formatSessionTime(session.startAt, session.endAt, session.timezone)}{' '}
                        <span className="text-xs text-muted-foreground">
                          ({formatSessionDuration(session.startAt, session.endAt)})
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Users className="size-3.5" /> Capacity & Consult
                      </span>
                      <p className="mt-0.5 font-medium">
                        {session.capacity} patients{' '}
                        <span className="text-xs text-muted-foreground">
                          ({session.expectedDurationMinutes} min/patient)
                        </span>
                      </p>
                    </div>
                    <div>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <MapPin className="size-3.5" /> Room / Location
                      </span>
                      <p className="mt-0.5 font-medium">{session.location ?? '—'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Internal Notes</span>
                      <p className="mt-0.5 font-medium">{session.internalNotes ?? '—'}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Actually opened</span>
                      <p className="mt-0.5 font-medium">
                        {formatClinicDateTime(session.openedAt, session.timezone)}
                      </p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">Actually closed</span>
                      <p className="mt-0.5 font-medium">
                        {formatClinicDateTime(session.closedAt, session.timezone)}
                      </p>
                    </div>
                  </div>

                  {session.cancellationReason ? (
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3 text-xs">
                      <span className="font-semibold text-destructive">Cancellation reason:</span>{' '}
                      {session.cancellationReason}
                    </div>
                  ) : null}

                  {/* Actions Toolbar */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <div className="flex flex-wrap gap-2">
                      {session.status === 'SCHEDULED' || session.status === 'OPEN' ? (
                        <Button
                          type="button"
                          onClick={() => {
                            onOpenChange(false);
                            if (onBookAppointment) {
                              onBookAppointment(session);
                            } else {
                              navigate(
                                `/appointments?create=1&sessionId=${session.id}&doctorId=${session.doctorId}`,
                              );
                            }
                          }}
                        >
                          Book Appointment
                        </Button>
                      ) : null}
                      <Button asChild type="button" variant="secondary">
                        <Link to={`/sessions/${session.id}/queue`}>Queue Board</Link>
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEditing(true)}
                        >
                          <Pencil className="size-3.5" />
                          Edit
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => setCancelOpen(true)}
                        >
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter className="sm:justify-between">
            {session ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  onOpenChange(false);
                  navigate(`/doctors/${session.doctorId}`);
                }}
              >
                <Stethoscope className="size-3.5" />
                View Doctor Profile
              </Button>
            ) : <div />}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {session ? (
        <SessionCancelDialog
          open={cancelOpen}
          onOpenChange={setCancelOpen}
          doctorName={session.doctorDisplayName ?? 'this doctor'}
          onConfirm={async (reason) => {
            const updated = await api<ConsultationSession>(
              `/clinic/sessions/${session.id}/cancel`,
              { method: 'POST', json: { reason } },
            );
            setSession(updated);
            onUpdated?.();
          }}
        />
      ) : null}
    </>
  );
}
