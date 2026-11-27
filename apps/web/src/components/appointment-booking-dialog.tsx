import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Lock, Phone, Search, X } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { addDaysIso, clinicTodayIso } from '@/features/sessions/utils/session-formatters';
import { useIsMobile } from '@/hooks/use-mobile';
import { PatientFormDialog } from '@/components/patient-form-dialog';
import { api, ApiError } from '@/lib/api';
import { notify } from '@/lib/notify';
import type {
  Appointment,
  ConsultationSession,
  Doctor,
  Patient,
  SessionAvailability,
} from '@/lib/clinic-types';

function formatSessionLabel(session: ConsultationSession) {
  const start = new Date(session.startAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  const end = new Date(session.endAt).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${session.localDate} · ${start} – ${end}`;
}

export type AppointmentBookingDefaults = {
  patientId?: string;
  doctorId?: string;
  sessionId?: string;
};

export function AppointmentBookingDialog({
  open,
  onOpenChange,
  defaults,
  onBooked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaults?: AppointmentBookingDefaults;
  onBooked?: () => void;
}) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const [patientQ, setPatientQ] = useState('');
  const [patientPhone, setPatientPhone] = useState('');
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [doctorId, setDoctorId] = useState('');
  const [sessionDate, setSessionDate] = useState(clinicTodayIso());
  const [sessions, setSessions] = useState<ConsultationSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [availability, setAvailability] = useState<SessionAvailability | null>(null);
  const [bookingSource, setBookingSource] = useState<'PHONE' | 'WALK_IN'>('PHONE');
  const [notes, setNotes] = useState('');
  const [step, setStep] = useState<'form' | 'confirm' | 'done'>('form');
  const [created, setCreated] = useState<Appointment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [registerPatientOpen, setRegisterPatientOpen] = useState(false);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

  const handleSelectPatient = (p: Patient) => {
    setSelectedPatient(p);
    setPatientQ(`${p.fullName} (${p.patientNumber})`);
    const phone = p.primaryContact?.displayValue ?? '';
    setPatientPhone(phone);
    setDropdownOpen(false);
    setPatientResults([]);
    setError(null);
  };

  const handleClearPatient = () => {
    setSelectedPatient(null);
    setPatientQ('');
    setPatientPhone('');
    setPatientResults([]);
    setDropdownOpen(false);
  };

  const handlePatientInputChange = (val: string) => {
    if (selectedPatient) {
      setSelectedPatient(null);
      setPatientPhone('');
    }
    setPatientQ(val);

    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!val.trim()) {
      setPatientResults([]);
      setDropdownOpen(false);
      setSearching(false);
      return;
    }

    setDropdownOpen(true);
    setSearching(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const data = await api<{ items: Patient[] }>(
          `/clinic/patients?${new URLSearchParams({
            q: val.trim(),
            status: 'ACTIVE',
            limit: '10',
          })}`,
          { toast: false },
        );
        setPatientResults(data.items);
      } catch {
        setPatientResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
  };

  useEffect(() => {
    if (!open) return;
    setError(null);
    setStep('form');
    setCreated(null);
    setPatientQ('');
    setPatientPhone('');
    setPatientResults([]);
    setSelectedPatient(null);
    setDropdownOpen(false);
    setDoctorId(defaults?.doctorId ?? '');
    setSessionId(defaults?.sessionId ?? '');
    setSessionDate(clinicTodayIso());
    setBookingSource('PHONE');
    setNotes('');
    setAvailability(null);
    idempotencyKeyRef.current = crypto.randomUUID();

    api<{ items: Doctor[] }>('/clinic/doctors?status=ACTIVE&limit=100', { toast: false })
      .then((data) => setDoctors(data.items))
      .catch(() => setDoctors([]));

    if (defaults?.patientId) {
      api<Patient>(`/clinic/patients/${defaults.patientId}`, { toast: false })
        .then((p) => {
          handleSelectPatient(p);
        })
        .catch(() => undefined);
    }
  }, [open, defaults?.patientId, defaults?.doctorId, defaults?.sessionId]);

  useEffect(() => {
    if (!open || !doctorId) {
      setSessions([]);
      setSessionsLoading(false);
      return;
    }
    let active = true;
    setSessionsLoading(true);
    const to = addDaysIso(sessionDate, 14);
    const qs = new URLSearchParams({
      doctorId,
      // Open (and paused/delayed) sessions stay bookable while they have room and have not ended.
      status: 'SCHEDULED,OPEN,PAUSED,DELAYED',
      from: sessionDate,
      to,
      limit: '50',
    });
    api<{ items: ConsultationSession[] }>(`/clinic/sessions?${qs}`, { toast: false })
      .then((data) => {
        if (!active) return;
        const bookable = data.items.filter((s) => new Date(s.endAt).getTime() > Date.now());
        setSessions(bookable);
        const current = sessionId ? bookable.find((s) => s.id === sessionId) : undefined;
        if (sessionId && !current) setSessionId('');
        // A preselected session on a later date moves "From date" to match it.
        if (current && current.localDate !== sessionDate) setSessionDate(current.localDate);
      })
      .catch(() => {
        if (active) setSessions([]);
      })
      .finally(() => {
        if (active) setSessionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, doctorId, sessionDate]);

  const sessionsOnDate = useMemo(
    () => sessions.filter((s) => s.localDate === sessionDate),
    [sessions, sessionDate],
  );
  const laterSessions = useMemo(
    () => sessions.filter((s) => s.localDate !== sessionDate),
    [sessions, sessionDate],
  );

  const handleSelectSession = (id: string) => {
    setSessionId(id);
    // Keep "From date" in sync with the chosen session's date.
    const chosen = sessions.find((s) => s.id === id);
    if (chosen && chosen.localDate !== sessionDate) setSessionDate(chosen.localDate);
  };

  useEffect(() => {
    if (!open || !sessionId) {
      setAvailability(null);
      return;
    }
    api<SessionAvailability>(`/clinic/sessions/${sessionId}/availability`, { toast: false })
      .then(setAvailability)
      .catch(() => setAvailability(null));
  }, [open, sessionId]);

  const selectedSession = useMemo(
    () => sessions.find((s) => s.id === sessionId) ?? null,
    [sessions, sessionId],
  );

  const goConfirm = () => {
    setError(null);
    if (!selectedPatient) {
      const message = 'Select a patient';
      setError(message);
      notify.validation(message);
      return;
    }
    if (!sessionId || !availability?.bookable) {
      const message = 'Select a bookable session with remaining capacity';
      setError(message);
      notify.validation(message);
      return;
    }
    setStep('confirm');
  };

  const submit = async () => {
    if (!selectedPatient || !sessionId) return;
    setSubmitting(true);
    setError(null);
    try {
      const appointment = await api<Appointment>('/clinic/appointments', {
        method: 'POST',
        json: {
          patientId: selectedPatient.id,
          sessionId,
          bookingSource,
          internalNotes: notes.trim() || undefined,
          idempotencyKey: idempotencyKeyRef.current,
        },
      });
      idempotencyKeyRef.current = crypto.randomUUID();
      setCreated(appointment);
      setStep('done');
      onBooked?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Booking failed');
      if (sessionId) {
        api<SessionAvailability>(`/clinic/sessions/${sessionId}/availability`, { toast: false })
          .then(setAvailability)
          .catch(() => undefined);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const body = (
    <div className="space-y-4">
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>Booking issue</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {step === 'done' && created ? (
        <div className="space-y-3 text-sm">
          <p className="text-4xl font-semibold tracking-wider text-primary">
            #{created.queueDisplay}
          </p>
          <p>
            <span className="text-muted-foreground">Booking ref:</span> {created.bookingReference}
          </p>
          <p>
            <span className="text-muted-foreground">Patient:</span> {created.patientFullName} (
            {created.patientNumber})
          </p>
          <p>
            <span className="text-muted-foreground">Doctor:</span> {created.doctorDisplayName}
          </p>
          <p>
            <span className="text-muted-foreground">Date:</span> {created.localDate}
          </p>
        </div>
      ) : null}

      {step === 'form' ? (
        <div className="space-y-5">
          <section className="space-y-3">
            <h3 className="text-sm font-semibold">1. Patient</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 relative" ref={dropdownRef}>
                <div className="flex items-center justify-between">
                  <Label htmlFor="patient-search-input">Name, mobile or patient ID</Label>
                  {selectedPatient && (
                    <button
                      type="button"
                      onClick={handleClearPatient}
                      className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 font-medium transition-colors"
                    >
                      <X className="size-3" />
                      Change
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    id="patient-search-input"
                    value={patientQ}
                    onChange={(e) => handlePatientInputChange(e.target.value)}
                    onFocus={() => {
                      if (!selectedPatient && patientQ.trim().length > 0) {
                        setDropdownOpen(true);
                      }
                    }}
                    placeholder="Type name or 07X mobile…"
                    className={`pl-9 ${
                      selectedPatient ? 'pr-8 font-medium border-primary/50 bg-primary/5 text-foreground' : ''
                    }`}
                    autoComplete="off"
                  />
                  {searching ? (
                    <Loader2 className="absolute right-3 top-2.5 size-4 animate-spin text-muted-foreground" />
                  ) : selectedPatient ? (
                    <button
                      type="button"
                      onClick={handleClearPatient}
                      className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                      title="Clear patient selection"
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>

                {/* Floating Search Dropdown */}
                {dropdownOpen && !selectedPatient && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
                    {searching ? (
                      <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                        <Loader2 className="size-3.5 animate-spin" />
                        Searching patients…
                      </div>
                    ) : patientResults.length === 0 ? (
                      <div className="p-3 text-center text-xs text-muted-foreground space-y-2">
                        <p>No patients found matching "{patientQ}".</p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => {
                            setDropdownOpen(false);
                            setRegisterPatientOpen(true);
                          }}
                        >
                          + Register as new patient
                        </Button>
                      </div>
                    ) : (
                      <ul className="divide-y divide-border/50 py-1">
                        {patientResults.map((p) => (
                          <li key={p.id}>
                            <button
                              type="button"
                              className="w-full px-3 py-2 text-left text-xs hover:bg-accent hover:text-accent-foreground transition-colors flex items-center justify-between"
                              onClick={() => handleSelectPatient(p)}
                            >
                              <div className="space-y-0.5">
                                <div className="font-semibold text-foreground flex items-center gap-2">
                                  <span>{p.fullName}</span>
                                  <Badge tone="suspended" className="font-mono text-[10px] px-1.5 py-0">
                                    {p.patientNumber}
                                  </Badge>
                                </div>
                                <div className="text-muted-foreground flex items-center gap-1.5">
                                  <Phone className="size-3 text-primary" />
                                  <span className="font-mono">{p.primaryContact?.displayValue ?? 'No phone recorded'}</span>
                                  {p.approximateAgeYears ? <span>· {p.approximateAgeYears} yrs</span> : null}
                                  {p.sex ? <span>· {p.sex}</span> : null}
                                </div>
                              </div>
                              <Check className="size-4 text-primary opacity-0 hover:opacity-100" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="patient-phone-input">Phone</Label>
                  {selectedPatient && (
                    <span className="text-[11px] text-emerald-700 dark:text-emerald-400 flex items-center gap-1 font-medium">
                      <Lock className="size-3" />
                      Locked to record
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Phone className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input
                    id="patient-phone-input"
                    value={patientPhone}
                    readOnly={Boolean(selectedPatient)}
                    onChange={(e) => !selectedPatient && setPatientPhone(e.target.value)}
                    placeholder="0771234567"
                    className={`pl-9 ${
                      selectedPatient
                        ? 'bg-muted/70 text-muted-foreground cursor-not-allowed select-none font-medium'
                        : ''
                    }`}
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-primary px-2"
                onClick={() => setRegisterPatientOpen(true)}
              >
                + Register new patient
              </Button>
              {selectedPatient && (
                <span className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="size-3.5" />
                  Selected: <strong>{selectedPatient.fullName}</strong>
                </span>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">2. Doctor & session</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Doctor</Label>
                <Select
                  value={doctorId || undefined}
                  onValueChange={(value) => {
                    setDoctorId(value);
                    setSessionId('');
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select doctor" />
                  </SelectTrigger>
                  <SelectContent>
                    {doctors.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>From date</Label>
                <Input
                  type="date"
                  min={clinicTodayIso()}
                  value={sessionDate}
                  onChange={(e) => {
                    // Appointments cannot be booked in the past: typed past dates snap back to today.
                    const today = clinicTodayIso();
                    const next = e.target.value;
                    setSessionDate(next && next < today ? today : next);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Available session</Label>
              <Select
                value={sessionId || undefined}
                onValueChange={handleSelectSession}
                disabled={!sessions.length}
              >
                <SelectTrigger className="w-full">
                  <SelectValue
                    placeholder={
                      !doctorId
                        ? 'Select a doctor first'
                        : sessionsLoading
                          ? 'Loading sessions…'
                          : sessionsOnDate.length
                            ? 'Select session'
                            : laterSessions.length
                              ? 'Select a session on another date'
                              : 'No sessions available'
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sessionsOnDate.length ? (
                    <SelectGroup>
                      <SelectLabel>Sessions on {sessionDate}</SelectLabel>
                      {sessionsOnDate.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {formatSessionLabel(s)} · cap {s.capacity}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {laterSessions.length ? (
                    <SelectGroup>
                      <SelectLabel>Next available sessions</SelectLabel>
                      {laterSessions.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {formatSessionLabel(s)} · cap {s.capacity}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
              {doctorId && !sessionsLoading && sessionsOnDate.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  No consultation sessions available for the selected date.
                  {laterSessions.length
                    ? ' Choose another date, or pick one of the next available sessions.'
                    : ' There are no sessions for this doctor in the next 14 days.'}
                </p>
              ) : null}
            </div>
            {availability ? (
              <p className="text-sm text-muted-foreground">
                Remaining places: <strong>{availability.remaining}</strong> /{' '}
                {availability.capacity}
                {availability.bookable ? '' : ' · not bookable'}
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <h3 className="text-sm font-semibold">3. Booking details</h3>
            <div className="space-y-1.5">
              <Label>Booking source</Label>
              <Select
                value={bookingSource}
                onValueChange={(value) => setBookingSource(value as 'PHONE' | 'WALK_IN')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PHONE">Phone</SelectItem>
                  <SelectItem value="WALK_IN">Walk-in</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Internal notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </section>
        </div>
      ) : null}

      {step === 'confirm' && selectedPatient && selectedSession ? (
        <div className="space-y-2 text-sm">
          <h3 className="text-sm font-semibold">4. Confirm appointment</h3>
          <p>
            <span className="text-muted-foreground">Patient:</span> {selectedPatient.fullName} (
            {selectedPatient.patientNumber})
          </p>
          <p>
            <span className="text-muted-foreground">Doctor:</span>{' '}
            {selectedSession.doctorDisplayName ??
              doctors.find((d) => d.id === doctorId)?.displayName}
          </p>
          <p>
            <span className="text-muted-foreground">Session:</span>{' '}
            {formatSessionLabel(selectedSession)}
          </p>
          <p>
            <span className="text-muted-foreground">Source:</span> {bookingSource}
          </p>
          <p className="text-xs text-muted-foreground">
            Availability snapshot: {availability?.remaining ?? '—'} remaining. Revalidated on
            submit.
          </p>
        </div>
      ) : null}
    </div>
  );

  const actions =
    step === 'done' && created ? (
      <>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          Close
        </Button>
        <Button
          type="button"
          onClick={() => {
            onOpenChange(false);
            navigate(`/appointments/${created.id}`);
          }}
        >
          View appointment
        </Button>
      </>
    ) : step === 'confirm' ? (
      <>
        <Button type="button" variant="secondary" onClick={() => setStep('form')} disabled={submitting}>
          Back
        </Button>
        <Button type="button" onClick={() => void submit()} disabled={submitting}>
          {submitting ? 'Booking…' : 'Confirm Appointment'}
        </Button>
      </>
    ) : (
      <>
        <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" onClick={goConfirm}>
          Review booking
        </Button>
      </>
    );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="bottom" className="flex max-h-[92vh] flex-col gap-0 p-0">
          <SheetHeader className="px-5 py-4 text-left">
            <SheetTitle>
              {step === 'done' ? 'Appointment confirmed' : 'Book appointment'}
            </SheetTitle>
            <SheetDescription>
              Select patient and consultation session. Queue numbers are assigned by the server.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-5 py-4">{body}</div>
          <SheetFooter className="px-5 py-4 sm:flex-row">{actions}</SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="px-6 pt-6 pb-2 text-left">
            <DialogTitle>
              {step === 'done' ? 'Appointment confirmed' : 'Book appointment'}
            </DialogTitle>
            <DialogDescription>
              Select patient and consultation session. Queue numbers are assigned by the server.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">{body}</div>
          <DialogFooter className="px-6 pt-2 pb-6">{actions}</DialogFooter>
        </DialogContent>
      </Dialog>

      <PatientFormDialog
        open={registerPatientOpen}
        onOpenChange={setRegisterPatientOpen}
        initialPhone={patientPhone}
        onSaved={(newPatient) => {
          handleSelectPatient(newPatient);
          setRegisterPatientOpen(false);
        }}
      />
    </>
  );
}
