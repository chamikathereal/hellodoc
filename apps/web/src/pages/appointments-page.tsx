import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AppointmentBookingDialog,
  type AppointmentBookingDefaults,
} from '@/components/appointment-booking-dialog';
import { AppointmentSessionPicker } from '@/components/appointment-session-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { clinicTodayIso } from '@/features/sessions/utils/session-formatters';
import { api, ApiError } from '@/lib/api';
import type { Appointment, ConsultationSession, Doctor } from '@/lib/clinic-types';
import { appointmentDisplayStatus } from '@/lib/clinic-types';
import { formatClinicDateTime, formatClinicTime } from '@/lib/visit-timings';

function formatTimeRange(startAt: string | null, endAt: string | null) {
  if (!startAt || !endAt) return '—';
  const opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: true };
  return `${new Date(startAt).toLocaleTimeString('en-US', opts)} – ${new Date(endAt).toLocaleTimeString('en-US', opts)}`;
}

export function AppointmentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = useMemo(() => clinicTodayIso(), []);
  const [items, setItems] = useState<Appointment[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [total, setTotal] = useState(0);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [doctorId, setDoctorId] = useState('');
  const [status, setStatus] = useState<'ALL' | 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED'>('CONFIRMED');
  const [q, setQ] = useState('');
  const [applied, setApplied] = useState<{
    from: string;
    to: string;
    doctorId: string;
    status: 'ALL' | 'CONFIRMED' | 'CANCELLED' | 'RESCHEDULED';
    q: string;
  }>({ from: today, to: today, doctorId: '', status: 'CONFIRMED', q: '' });
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [bookDefaults, setBookDefaults] = useState<AppointmentBookingDefaults>({});
  // With a doctor selected, appointments are shown one consultation session at a time.
  const [selectedSession, setSelectedSession] = useState<ConsultationSession | null>(null);
  const [sessionsRefreshKey, setSessionsRefreshKey] = useState(0);
  const sessionMode = Boolean(applied.doctorId);
  // Actual open/close times of the selected session (from the session detail API).
  const [sessionTimes, setSessionTimes] = useState<{ openedAt: string | null; closedAt: string | null } | null>(null);

  useEffect(() => {
    setSessionTimes(null);
    if (!selectedSession) return;
    let cancelled = false;
    api<ConsultationSession>(`/clinic/sessions/${selectedSession.id}`, { toast: false })
      .then((s) => {
        if (!cancelled) setSessionTimes({ openedAt: s.openedAt ?? null, closedAt: s.closedAt ?? null });
      })
      .catch(() => {
        if (!cancelled) setSessionTimes(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSession]);

  const openBook = useCallback((defaults: AppointmentBookingDefaults = {}) => {
    setBookDefaults(defaults);
    setBookOpen(true);
  }, []);

  const closeBook = useCallback(
    (open: boolean) => {
      setBookOpen(open);
      if (!open) {
        setBookDefaults({});
        const next = new URLSearchParams(searchParams);
        next.delete('create');
        next.delete('patientId');
        next.delete('doctorId');
        next.delete('sessionId');
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (searchParams.get('create') !== '1') return;
    openBook({
      patientId: searchParams.get('patientId') ?? undefined,
      doctorId: searchParams.get('doctorId') ?? undefined,
      sessionId: searchParams.get('sessionId') ?? undefined,
    });
  }, [searchParams, openBook]);

  const load = useCallback(async () => {
    if (applied.doctorId && !selectedSession) {
      setItems([]);
      setTotal(0);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        status: applied.status,
      });
      if (applied.doctorId && selectedSession) {
        params.set('sessionId', selectedSession.id);
      } else {
        params.set('from', applied.from);
        params.set('to', applied.to);
      }
      if (applied.q.trim()) params.set('q', applied.q.trim());
      const data = await api<{ items: Appointment[]; total: number }>(
        `/clinic/appointments?${params}`,
      );
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load appointments');
    } finally {
      setLoading(false);
    }
  }, [applied, offset, selectedSession]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ items: Doctor[] }>('/clinic/doctors?status=ACTIVE&limit=100', { toast: false })
      .then((data) => setDoctors(data.items))
      .catch(() => setDoctors([]));
  }, []);


  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Appointments</h1>
          <p className="text-sm text-muted-foreground">
            Book patients into consultation sessions and manage queue numbers.
          </p>
        </div>
        <Button type="button" onClick={() => openBook()}>
          + Book Appointment
        </Button>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">From</label>
            <Input
              type="date"
              value={from}
              disabled={Boolean(doctorId)}
              title={doctorId ? 'With a doctor selected, pick a session below instead' : undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">To</label>
            <Input
              type="date"
              value={to}
              disabled={Boolean(doctorId)}
              title={doctorId ? 'With a doctor selected, pick a session below instead' : undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Doctor</label>
            <select
              className="h-9 rounded-md border border-input bg-background text-foreground px-3 text-sm shadow-xs focus:outline-hidden focus:ring-1 focus:ring-ring"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
            >
              <option value="">All doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Status</label>
            <select
              className="h-9 rounded-md border border-input bg-background text-foreground px-3 text-sm shadow-xs focus:outline-hidden focus:ring-1 focus:ring-ring"
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              <option value="CONFIRMED">Confirmed</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="RESCHEDULED">Rescheduled</option>
              <option value="ALL">All</option>
            </select>
          </div>
          <Input
            placeholder="Search patient / booking ref"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="lg:max-w-xs"
          />
          <Button
            type="button"
            onClick={() => {
              setOffset(0);
              if (doctorId !== applied.doctorId) setSelectedSession(null);
              setApplied({ from, to, doctorId, status, q });
            }}
          >
            Apply
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setFrom(today);
              setTo(today);
              setDoctorId('');
              setStatus('CONFIRMED');
              setQ('');
              setOffset(0);
              setSelectedSession(null);
              setApplied({ from: today, to: today, doctorId: '', status: 'CONFIRMED', q: '' });
            }}
          >
            Reset
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessionMode ? (
            <AppointmentSessionPicker
              doctorId={applied.doctorId}
              selectedSessionId={selectedSession?.id ?? ''}
              refreshKey={sessionsRefreshKey}
              onSelect={(session) => {
                setOffset(0);
                setSelectedSession(session);
              }}
            />
          ) : null}
          {sessionMode && selectedSession ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
              <div>
                <span className="font-semibold text-foreground">
                  {selectedSession.doctorDisplayName ?? 'Doctor'} · {selectedSession.localDate}
                </span>
                <span className="text-muted-foreground">
                  {' '}
                  · {formatTimeRange(selectedSession.startAt, selectedSession.endAt)} · Capacity{' '}
                  {selectedSession.capacity}
                </span>
                <div className="text-xs text-muted-foreground">
                  Actually opened: {formatClinicDateTime(sessionTimes?.openedAt, selectedSession.timezone)}
                  {' · '}
                  Actually closed: {formatClinicDateTime(sessionTimes?.closedAt, selectedSession.timezone)}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {selectedSession.status === 'SCHEDULED' || selectedSession.status === 'OPEN' ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      openBook({ doctorId: selectedSession.doctorId, sessionId: selectedSession.id })
                    }
                  >
                    Book into this session
                  </Button>
                ) : null}
                <Button asChild type="button" size="sm" variant="secondary">
                  <Link to={`/sessions/${selectedSession.id}/queue`}>Queue Board</Link>
                </Button>
              </div>
            </div>
          ) : null}
          {sessionMode && !selectedSession ? null : loading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : null}
          {error ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="secondary" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}
          {!loading && !error && items.length === 0 && !(sessionMode && !selectedSession) ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No appointments found for these filters.</p>
              <Button
                type="button"
                variant="secondary"
                className="mt-3"
                onClick={() => openBook()}
              >
                Book appointment
              </Button>
            </div>
          ) : null}
          {items.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-border/80 bg-card shadow-2xs">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Queue</TableHead>
                    <TableHead>Patient</TableHead>
                    {sessionMode ? null : (
                      <>
                        <TableHead>Doctor</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Session</TableHead>
                      </>
                    )}
                    {sessionMode ? (
                      <>
                        <TableHead>Checked in</TableHead>
                        <TableHead>Consult start</TableHead>
                        <TableHead>Consult end</TableHead>
                      </>
                    ) : null}
                    <TableHead>Source</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono font-semibold tracking-wide">
                        {item.queueDisplay}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{item.patientFullName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{item.patientNumber}</div>
                      </TableCell>
                      {sessionMode ? null : (
                        <>
                          <TableCell>{item.doctorDisplayName ?? '—'}</TableCell>
                          <TableCell>{item.localDate ?? '—'}</TableCell>
                          <TableCell className="text-sm">
                            {formatTimeRange(item.startAt, item.endAt)}
                          </TableCell>
                        </>
                      )}
                      {sessionMode ? (
                        <>
                          <TableCell className="text-sm">{formatClinicTime(item.checkedInAt, item.timezone ?? undefined)}</TableCell>
                          <TableCell className="text-sm">
                            {formatClinicTime(item.consultationStartedAt, item.timezone ?? undefined)}
                          </TableCell>
                          <TableCell className="text-sm">
                            {formatClinicTime(item.consultationEndedAt, item.timezone ?? undefined)}
                          </TableCell>
                        </>
                      ) : null}
                      <TableCell>{item.bookingSource}</TableCell>
                      <TableCell>
                        <Badge
                          tone={
                            item.status === 'CONFIRMED'
                              ? 'active'
                              : item.status === 'CANCELLED'
                                ? 'suspended'
                                : 'pending'
                          }
                        >
                          {appointmentDisplayStatus(item)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button asChild size="sm" variant="ghost">
                          <Link to={`/appointments/${item.id}`}>View</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="border-t border-border/70 bg-muted/20 px-4 py-3">
                <TablePagination
                  total={total}
                  limit={limit}
                  offset={offset}
                  pageSizeOptions={[10, 20, 30, 50]}
                  onPageChange={setOffset}
                  onLimitChange={(newLimit) => {
                    setLimit(newLimit);
                    setOffset(0);
                  }}
                  disabled={loading}
                />
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AppointmentBookingDialog
        open={bookOpen}
        onOpenChange={closeBook}
        defaults={bookDefaults}
        onBooked={() => {
          void load();
          setSessionsRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
