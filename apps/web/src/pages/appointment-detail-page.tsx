import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { AppointmentTimingsCard } from '@/components/appointment-timings-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { addDaysIso, clinicTodayIso } from '@/features/sessions/utils/session-formatters';
import { api, ApiError } from '@/lib/api';
import type { Appointment, ConsultationSession } from '@/lib/clinic-types';
import { appointmentDisplayStatus } from '@/lib/clinic-types';

export function AppointmentDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  /** For a RESCHEDULED appointment: the current booking that replaced it. */
  const [currentBooking, setCurrentBooking] = useState<Appointment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [showCancel, setShowCancel] = useState(false);
  const [showReschedule, setShowReschedule] = useState(false);
  const [sessions, setSessions] = useState<ConsultationSession[]>([]);
  const [newSessionId, setNewSessionId] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const [trackingUrl, setTrackingUrl] = useState<string | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setError(null);
    try {
      const data = await api<Appointment>(`/clinic/appointments/${id}`);
      setAppointment(data);
      setCurrentBooking(
        data.status === 'RESCHEDULED' && data.rescheduledToId
          ? await api<Appointment>(`/clinic/appointments/${data.rescheduledToId}`)
          : null,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load appointment');
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  // Reschedule/cancel act on this appointment, or on the booking that replaced it when it was rescheduled.
  const actionTarget = appointment?.status === 'RESCHEDULED' ? currentBooking : appointment;
  const canChangeBooking = actionTarget?.status === 'CONFIRMED' && !actionTarget.checkedInAt;

  useEffect(() => {
    if (!showReschedule || !actionTarget?.doctorId) return;
    const from = clinicTodayIso();
    const to = addDaysIso(from, 21);
    const qs = new URLSearchParams({
      doctorId: actionTarget.doctorId,
      status: 'SCHEDULED',
      from,
      to,
      limit: '50',
    });
    api<{ items: ConsultationSession[] }>(`/clinic/sessions?${qs}`, { toast: false })
      .then((data) =>
        setSessions(
          data.items.filter(
            (s) => s.id !== actionTarget.sessionId && new Date(s.endAt).getTime() > Date.now(),
          ),
        ),
      )
      .catch(() => setSessions([]));
  }, [showReschedule, actionTarget?.doctorId, actionTarget?.sessionId]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!appointment) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const onCancel = async () => {
    if (cancelReason.trim().length < 3 || !actionTarget) return;
    setBusy(true);
    try {
      const updated = await api<Appointment>(`/clinic/appointments/${actionTarget.id}/cancel`, {
        method: 'POST',
        json: { reason: cancelReason.trim() },
      });
      if (actionTarget.id === appointment.id) setAppointment(updated);
      else setCurrentBooking(updated);
      setShowCancel(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Cancel failed');
    } finally {
      setBusy(false);
    }
  };

  const onReschedule = async () => {
    if (!newSessionId || !actionTarget) return;
    setBusy(true);
    try {
      const created = await api<Appointment>(`/clinic/appointments/${actionTarget.id}/reschedule`, {
        method: 'POST',
        json: {
          newSessionId,
          reason: rescheduleReason.trim() || undefined,
          idempotencyKey: crypto.randomUUID(),
        },
      });
      navigate(`/appointments/${created.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reschedule failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs tracking-wide text-muted-foreground">
            {appointment.bookingReference}
          </p>
          <h1 className="text-3xl font-semibold tracking-wider text-primary">
            Queue #{appointment.queueDisplay}
          </h1>
          <div className="mt-2">
            <Badge
              tone={
                appointment.status === 'CONFIRMED'
                  ? 'active'
                  : appointment.status === 'CANCELLED'
                    ? 'suspended'
                    : 'pending'
              }
            >
              {appointmentDisplayStatus(appointment)}
            </Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {appointment.status === 'CONFIRMED' ? (
            <>
              {!appointment.checkedInAt ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await api(`/clinic/appointments/${appointment.id}/check-in`, {
                        method: 'POST',
                        json: {},
                      });
                      // Reload so the status badge reflects the check-in immediately.
                      const refreshed = await api<Appointment>(`/clinic/appointments/${appointment.id}`);
                      setAppointment(refreshed);
                      setCopyMsg('Patient checked in');
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : 'Check-in failed');
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Check in
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const link = await api<{ url: string }>(
                      `/clinic/appointments/${appointment.id}/tracking-link`,
                      { method: 'POST', json: {} },
                    );
                    setTrackingUrl(link.url);
                    await navigator.clipboard.writeText(link.url);
                    setCopyMsg('Tracking link copied');
                  } catch (err) {
                    setError(err instanceof ApiError ? err.message : 'Tracking link failed');
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Copy Tracking Link
              </Button>
            </>
          ) : null}
          {/* Confirmed (or the booking that replaced a rescheduled one): reschedule and cancel are allowed.
              Checked in or cancelled: no further reschedule or cancel. */}
          {canChangeBooking ? (
            <>
              <Button type="button" variant="secondary" onClick={() => setShowReschedule(true)}>
                Reschedule
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowCancel(true)}>
                Cancel
              </Button>
            </>
          ) : null}
          <Link to="/appointments">
            <Button type="button" variant="outline">
              Back
            </Button>
          </Link>
        </div>
      </div>

      {copyMsg ? <p className="text-sm text-primary">{copyMsg}</p> : null}
      {trackingUrl ? (
        <p className="break-all rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          {trackingUrl}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Patient</h2>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>{appointment.patientFullName}</p>
            <p className="font-mono text-xs">{appointment.patientNumber}</p>
            <Link to={`/patients/${appointment.patientId}`}>
              <Button size="sm" variant="outline" type="button">
                Open patient
              </Button>
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Session</h2>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p>
              <span className="text-muted-foreground">Doctor:</span> {appointment.doctorDisplayName}
            </p>
            <p>
              <span className="text-muted-foreground">Date:</span> {appointment.localDate}
            </p>
            <p>
              <span className="text-muted-foreground">Time:</span>{' '}
              {appointment.startAt
                ? new Date(appointment.startAt).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })
                : '—'}
              {' – '}
              {appointment.endAt
                ? new Date(appointment.endAt).toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true,
                  })
                : '—'}
            </p>
            <Link to={`/sessions/${appointment.sessionId}`}>
              <Button size="sm" variant="outline" type="button">
                Open session
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Booking details</h2>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
          <p>
            <span className="text-muted-foreground">Source:</span> {appointment.bookingSource}
          </p>
          <p>
            <span className="text-muted-foreground">Created:</span>{' '}
            {new Date(appointment.createdAt).toLocaleString()}
          </p>
          {appointment.internalNotes ? (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Notes:</span> {appointment.internalNotes}
            </p>
          ) : null}
          {appointment.cancellationReason ? (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Cancellation:</span> {appointment.cancellationReason}
            </p>
          ) : null}
          {appointment.status === 'RESCHEDULED' && currentBooking ? (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Rescheduled to:</span>{' '}
              <Link className="text-primary underline" to={`/appointments/${currentBooking.id}`}>
                {currentBooking.bookingReference}
              </Link>{' '}
              ({appointmentDisplayStatus(currentBooking)}
              {currentBooking.localDate ? ` · ${currentBooking.localDate}` : ''})
            </p>
          ) : null}
          {appointment.rescheduledFromId ? (
            <p className="sm:col-span-2">
              <span className="text-muted-foreground">Rescheduled from:</span>{' '}
              <Link className="text-primary underline" to={`/appointments/${appointment.rescheduledFromId}`}>
                previous appointment
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <AppointmentTimingsCard appointment={appointment} />

      {showCancel ? (
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Cancel appointment</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {actionTarget && actionTarget.id !== appointment.id
                ? `This cancels the current booking ${actionTarget.bookingReference}. `
                : ''}
              Queue number {actionTarget?.queueDisplay ?? appointment.queueDisplay} remains reserved and will
              not be reused.
            </p>
            <div>
              <Label>Reason</Label>
              <Input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy || cancelReason.trim().length < 3}
                onClick={() => void onCancel()}
              >
                Confirm cancel
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowCancel(false)}>
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {showReschedule ? (
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Reschedule appointment</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            {actionTarget && actionTarget.id !== appointment.id ? (
              <p className="text-sm text-muted-foreground">
                This reschedules the current booking {actionTarget.bookingReference}.
              </p>
            ) : null}
            <div>
              <Label>New session</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background text-foreground px-3 text-sm shadow-xs focus:outline-hidden focus:ring-1 focus:ring-ring"
                value={newSessionId}
                onChange={(e) => setNewSessionId(e.target.value)}
              >
                <option value="">Select destination session</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.localDate} ·{' '}
                    {new Date(s.startAt).toLocaleTimeString('en-US', {
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true,
                    })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Reason (optional)</Label>
              <Input
                value={rescheduleReason}
                onChange={(e) => setRescheduleReason(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy || !newSessionId}
                onClick={() => void onReschedule()}
              >
                Confirm reschedule
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowReschedule(false)}>
                Close
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
