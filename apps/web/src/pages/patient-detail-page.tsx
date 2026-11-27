import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Calendar,
  ChevronDown,
  FileText,
  Link2,
  MapPin,
  MessageSquare,
  Phone,
  Plus,
  Receipt,
  Shield,
  Stethoscope,
  User,
  Users,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  displayPatientAge,
  formatRegisteredDate,
} from '@/features/patients/utils/patient-display';
import { PrintDocumentButton } from '@/components/print-document-button';
import { api, ApiError, openProtectedDocument } from '@/lib/api';
import { notify } from '@/lib/notify';
import { useClinicAuth } from '@/lib/auth';
import type { Patient } from '@/lib/clinic-types';

type AuditItem = {
  id: string;
  action: string;
  actorId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type SmsRow = {
  id: string;
  eventType: string;
  recipientMasked: string;
  status: string;
  errorCategory: string | null;
  createdAt: string;
};

type AppointmentRow = {
  id: string;
  bookingReference: string;
  doctorName: string;
  doctorSpecialization?: string | null;
  sessionDate: string;
  sessionStartAt: string;
  queueNumber: number;
  queueDisplay: string;
  status: string;
};

type InvoiceRow = {
  id: string;
  invoiceNumber: string | null;
  status: string;
  invoiceTotal: string;
  paid: string;
  balance: string;
  settlement: string;
};

type EncounterRow = {
  id: string;
  appointment_id: string;
  session_id: string;
  doctor_id: string;
  status: string;
  chief_complaint: string | null;
  history_present_illness: string | null;
  examination_findings: string | null;
  assessment: string | null;
  treatment_plan: string | null;
  follow_up_instructions: string | null;
  signed_at: string | null;
  created_at: string;
  doctor_name: string;
  doctor_specialization: string | null;
  session_date: string;
  session_start_at: string;
  session_end_at: string;
  booking_reference: string;
  queue_number: number;
  appointment_status: string;
  queue_display: string;
  latest_vitals: {
    systolic_mmhg: number | null;
    diastolic_mmhg: number | null;
    pulse_bpm: number | null;
    temperature_c: string | number | null;
    recorded_at: string;
  } | null;
  prescription: {
    id: string;
    status: string;
    version: number;
    /** Present only for a signed prescription. */
    clinical_instructions?: string | null;
    items?: Array<{ medicine_name: string; dose: string; frequency: string; instructions: string | null }>;
  } | null;
};

type ClinicalHistory = {
  encounters: EncounterRow[];
  history: Array<{ id: string; category: string; summary: string; created_at: string }>;
  allergies: {
    status: string;
    items: Array<{ substance: string; reaction: string | null; severity?: string | null }>;
  };
};

type RelatedPatient = {
  id: string;
  patientNumber: string;
  fullName: string;
  preferredName: string | null;
  status: string;
  dateOfBirth: string | null;
  approximateAgeYears: number | null;
  sharedContact: {
    displayValue: string;
    normalizedValue: string;
    contactType: string;
    masked: string;
  };
  relationshipLabel: string;
  contactPersonName: string | null;
};

function DetailRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border/60 py-2.5 last:border-b-0 sm:grid-cols-[140px_1fr] sm:gap-4">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value || '—'}</dd>
    </div>
  );
}

function formatSessionDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatSessionTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
}

function noteField(label: string, value: string | null | undefined) {
  if (!value?.trim()) return null;
  return (
    <div className="rounded-lg border border-border/70 bg-muted/30 px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{value}</p>
    </div>
  );
}

function statusTone(status: string) {
  const s = status.toUpperCase();
  if (s === 'ACTIVE' || s === 'CONFIRMED' || s === 'PAID' || s === 'SETTLED' || s === 'COMPLETED') {
    return 'active' as const;
  }
  if (s === 'SCHEDULED' || s === 'PENDING' || s === 'PARTIAL' || s === 'CALLED') {
    return 'pending' as const;
  }
  if (s === 'CANCELLED' || s === 'VOID' || s === 'INACTIVE' || s === 'SUSPENDED') {
    return 'suspended' as const;
  }
  return 'default' as const;
}

export function PatientDetailPage() {
  const { id } = useParams();
  const { user } = useClinicAuth();
  const isDoctor = user?.role === 'clinic_doctor';
  const [patient, setPatient] = useState<Patient | null>(null);
  const [audit, setAudit] = useState<AuditItem[]>([]);
  const [sms, setSms] = useState<SmsRow[]>([]);
  const [appointments, setAppointments] = useState<AppointmentRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [clinical, setClinical] = useState<ClinicalHistory | null>(null);
  const [related, setRelated] = useState<RelatedPatient[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState('');
  const [showDeactivate, setShowDeactivate] = useState(false);

  const load = async () => {
    if (!id) return;
    setError(null);
    try {
      // Doctors only see clinical information, so the administrative data is not loaded for them.
      const none = { items: [] };
      const [p, a, messages, appts, relatedPatients] = await Promise.all([
        api<Patient>(`/clinic/patients/${id}`),
        isDoctor
          ? { items: [] as AuditItem[] }
          : api<{ items: AuditItem[] }>(`/clinic/patients/${id}/audit`, { toast: false }).catch(() => none),
        isDoctor
          ? { items: [] as SmsRow[] }
          : api<{ items: SmsRow[] }>(`/clinic/patients/${id}/notifications`, { toast: false }).catch(() => none),
        isDoctor
          ? { items: [] as AppointmentRow[] }
          : api<{ items: AppointmentRow[] }>(`/clinic/appointments?patientId=${id}&limit=50`, { toast: false }).catch(
              () => none,
            ),
        isDoctor
          ? { items: [] as RelatedPatient[] }
          : api<{ items: RelatedPatient[] }>(`/clinic/patients/${id}/related`, { toast: false }).catch(() => none),
      ]);
      setPatient(p);
      setAudit(a.items);
      setSms(messages.items);
      setAppointments(appts.items);
      setRelated(relatedPatients.items);

      if (p.patientNumber && !isDoctor) {
        void api<{ items: InvoiceRow[] }>(`/clinic/invoices?q=${encodeURIComponent(p.patientNumber)}&limit=50`, {
          toast: false,
        })
          .then((inv) => setInvoices(inv.items))
          .catch(() => setInvoices([]));
      }

      void api<ClinicalHistory>(`/clinic/patients/${id}/clinical-history`, { toast: false })
        .then((ch) => setClinical(ch))
        .catch(() => setClinical(null));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load patient registry');
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const visitsByDate = useMemo(() => {
    const groups = new Map<
      string,
      {
        date: string;
        sessions: Map<
          string,
          {
            sessionId: string;
            doctorName: string;
            doctorSpecialization: string | null;
            startAt: string;
            endAt: string;
            encounters: EncounterRow[];
          }
        >;
      }
    >();

    for (const encounter of clinical?.encounters ?? []) {
      const dateKey = String(encounter.session_date).slice(0, 10);
      if (!groups.has(dateKey)) {
        groups.set(dateKey, { date: dateKey, sessions: new Map() });
      }
      const day = groups.get(dateKey)!;
      if (!day.sessions.has(encounter.session_id)) {
        day.sessions.set(encounter.session_id, {
          sessionId: encounter.session_id,
          doctorName: encounter.doctor_name,
          doctorSpecialization: encounter.doctor_specialization,
          startAt: encounter.session_start_at,
          endAt: encounter.session_end_at,
          encounters: [],
        });
      }
      day.sessions.get(encounter.session_id)!.encounters.push(encounter);
    }

    return [...groups.values()].map((day) => ({
      date: day.date,
      sessions: [...day.sessions.values()],
    }));
  }, [clinical?.encounters]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!patient) return <p className="text-sm text-muted-foreground">Loading patient record…</p>;

  const onDeactivate = async () => {
    if (!reason.trim()) return;
    setBusy(true);
    try {
      const updated = await api<Patient>(`/clinic/patients/${patient.id}/deactivate`, {
        method: 'POST',
        json: { reason: reason.trim() },
      });
      setPatient(updated);
      setShowDeactivate(false);
      setReason('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Deactivate failed');
    } finally {
      setBusy(false);
    }
  };

  const onReactivate = async () => {
    setBusy(true);
    try {
      const updated = await api<Patient>(`/clinic/patients/${patient.id}/reactivate`, {
        method: 'POST',
        json: {},
      });
      setPatient(updated);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Reactivate failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs tracking-wider text-muted-foreground uppercase">{patient.patientNumber}</span>
            <Badge tone={statusTone(patient.status)}>{patient.status}</Badge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground mt-1">
            {patient.preferredName || patient.fullName}
          </h1>
          {patient.preferredName ? (
            <p className="text-sm text-muted-foreground">Official: {patient.fullName}</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {/* Doctors review history only; patient management stays with front desk and managers. */}
          {!isDoctor && patient.status === 'ACTIVE' ? (
            <Link to={`/appointments/new?patientId=${patient.id}`}>
              <Button type="button" size="sm">
                <Plus className="size-3.5 mr-1" /> Book Appointment
              </Button>
            </Link>
          ) : null}
          {!isDoctor ? (
            <Link to={`/patients/${patient.id}/edit`}>
              <Button type="button" size="sm" variant="secondary">
                Edit Patient
              </Button>
            </Link>
          ) : null}
          {isDoctor ? null : patient.status === 'ACTIVE' ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setShowDeactivate(true)}
            >
              Deactivate
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void onReactivate()}>
              Reactivate
            </Button>
          )}
          <Link to={isDoctor ? '/doctor/worklist' : '/patients'}>
            <Button type="button" size="sm" variant="ghost">
              {isDoctor ? 'Back to worklist' : 'Back to directory'}
            </Button>
          </Link>
        </div>
      </div>

      {showDeactivate ? (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader>
            <CardTitle className="text-base text-destructive">Confirm deactivation</CardTitle>
            <CardDescription>
              The patient record and number will be preserved. Please provide a reason for the audit trail.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="reason">Reason</Label>
              <Input
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Duplicate entry / patient moved away"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="destructive" disabled={busy || reason.trim().length < 3} onClick={() => void onDeactivate()}>
                Confirm deactivate
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowDeactivate(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Registry Tabs */}
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto gap-1 p-1 bg-muted/60">
          <TabsTrigger value="overview" className="gap-1.5 text-xs sm:text-sm">
            <User className="size-3.5" /> Overview
          </TabsTrigger>
          {/* Doctors see clinical information only; visits, billing, SMS and audit stay with clinic staff. */}
          {!isDoctor ? (
            <TabsTrigger value="visits" className="gap-1.5 text-xs sm:text-sm">
              <Calendar className="size-3.5" /> Visits ({appointments.length})
            </TabsTrigger>
          ) : null}
          <TabsTrigger value="medical" className="gap-1.5 text-xs sm:text-sm">
            <Stethoscope className="size-3.5" /> Medical History
          </TabsTrigger>
          {!isDoctor ? (
            <>
              <TabsTrigger value="billing" className="gap-1.5 text-xs sm:text-sm">
                <Receipt className="size-3.5" /> Invoices ({invoices.length})
              </TabsTrigger>
              <TabsTrigger value="sms" className="gap-1.5 text-xs sm:text-sm">
                <MessageSquare className="size-3.5" /> SMS Logs ({sms.length})
              </TabsTrigger>
              <TabsTrigger value="audit" className="gap-1.5 text-xs sm:text-sm">
                <Shield className="size-3.5" /> Audit Trail
              </TabsTrigger>
            </>
          ) : null}
        </TabsList>

        {/* TAB 1: OVERVIEW */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <User className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Personal details</CardTitle>
                    <CardDescription>Identity and demographics on file for this patient.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <dl>
                  <DetailRow label="Full name" value={patient.fullName} />
                  <DetailRow label="Preferred name" value={patient.preferredName ?? '—'} />
                  <DetailRow label="Age / DOB" value={displayPatientAge(patient)} />
                  <DetailRow label="Sex" value={patient.sex ?? '—'} />
                  <DetailRow
                    label="Address"
                    value={
                      patient.address ? (
                        <span className="inline-flex items-start gap-1.5">
                          <MapPin className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                          {patient.address}
                        </span>
                      ) : (
                        '—'
                      )
                    }
                  />
                </dl>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Phone className="size-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base">Contact information</CardTitle>
                    <CardDescription>Phones and guardians used for booking and SMS.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {patient.contacts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-muted/30 px-3 py-4 text-sm text-muted-foreground">
                    No phone on file.
                    {patient.contactExceptionReason
                      ? ` Exception: ${patient.contactExceptionReason}`
                      : ''}
                  </div>
                ) : (
                  patient.contacts.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl border border-border bg-muted/20 px-3 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge tone={c.isPrimary ? 'active' : 'default'}>{c.contactType}</Badge>
                          {c.isPrimary ? (
                            <span className="text-[11px] font-medium uppercase tracking-wide text-primary">
                              Primary
                            </span>
                          ) : null}
                        </div>
                        <span className="font-mono text-sm font-semibold text-foreground">
                          {c.displayValue}
                        </span>
                      </div>
                      {c.contactPersonName || c.relationship ? (
                        <p className="mt-2 text-xs text-muted-foreground">
                          {c.contactPersonName ?? 'Contact person'}
                          {c.relationship ? ` · ${c.relationship}` : ''}
                        </p>
                      ) : null}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {!isDoctor ? (
            <>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Users className="size-4" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Related patients</CardTitle>
                        <CardDescription>
                          Other patient records linked by the same phone number or guardian contact.
                        </CardDescription>
                      </div>
                    </div>
                    <Badge tone={related.length > 0 ? 'pending' : 'default'}>
                      {related.length} linked
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  {related.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-6 text-center">
                      <Link2 className="mx-auto size-5 text-muted-foreground" />
                      <p className="mt-2 text-sm font-medium text-foreground">No shared-contact relationships</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        When another patient uses the same mobile or guardian number, they will appear here.
                      </p>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {related.map((item) => (
                        <Link
                          key={`${item.id}-${item.sharedContact.normalizedValue}`}
                          to={`/patients/${item.id}`}
                          className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-muted/30"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-foreground">
                                {item.preferredName || item.fullName}
                              </p>
                              <p className="font-mono text-[11px] text-muted-foreground">
                                {item.patientNumber}
                              </p>
                            </div>
                            <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                          </div>
                          <div className="mt-3 space-y-1.5 text-xs">
                            <p className="font-medium text-primary">{item.relationshipLabel}</p>
                            <p className="text-muted-foreground">
                              Shared {item.sharedContact.contactType.toLowerCase()}:{' '}
                              <span className="font-mono text-foreground">
                                {item.sharedContact.displayValue}
                              </span>
                            </p>
                            {item.contactPersonName ? (
                              <p className="text-muted-foreground">Contact person: {item.contactPersonName}</p>
                            ) : null}
                            <p className="text-muted-foreground">
                              Age:{' '}
                              {displayPatientAge({
                                dateOfBirth: item.dateOfBirth,
                                approximateAgeYears: item.approximateAgeYears,
                                ageRecordedOn: null,
                              })}
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Administrative details</CardTitle>
                  <CardDescription>Registry timestamps and record status.</CardDescription>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-x-6 sm:grid-cols-2">
                    <DetailRow label="Registered on" value={formatRegisteredDate(patient.createdAt)} />
                    <DetailRow label="Last updated" value={formatRegisteredDate(patient.updatedAt)} />
                    {patient.deactivationReason ? (
                      <div className="sm:col-span-2">
                        <DetailRow
                          label="Deactivation"
                          value={<span className="text-destructive">{patient.deactivationReason}</span>}
                        />
                      </div>
                    ) : null}
                  </dl>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        {/* TAB 2: VISITS & APPOINTMENTS */}
        <TabsContent value="visits">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Appointment & Visit History</CardTitle>
                <CardDescription>All clinical sessions and queue tokens for this patient.</CardDescription>
              </div>
              <Link to={`/appointments/new?patientId=${patient.id}`}>
                <Button size="sm">
                  <Plus className="size-3.5 mr-1" /> New Appointment
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Queue #</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead>Date / Time</TableHead>
                    <TableHead>Attending Doctor</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {appointments.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        No appointments recorded for this patient yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    appointments.map((appt) => (
                      <TableRow key={appt.id}>
                        <TableCell className="font-semibold text-foreground">
                          {appt.queueDisplay || String(appt.queueNumber).padStart(3, '0')}
                        </TableCell>
                        <TableCell className="font-mono text-xs">{appt.bookingReference}</TableCell>
                        <TableCell>{appt.sessionDate} {appt.sessionStartAt ? `(${appt.sessionStartAt})` : ''}</TableCell>
                        <TableCell>
                          <span className="font-medium">{appt.doctorName}</span>
                          {appt.doctorSpecialization ? (
                            <span className="text-xs text-muted-foreground block">{appt.doctorSpecialization}</span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Badge tone={statusTone(appt.status)}>{appt.status}</Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: MEDICAL HISTORY */}
        <TabsContent value="medical" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Allergy Status</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p className="font-medium">
                Status:{' '}
                <Badge tone={clinical?.allergies.status === 'NO_KNOWN_ALLERGIES' ? 'active' : 'pending'}>
                  {clinical?.allergies.status ?? 'UNKNOWN'}
                </Badge>
              </p>
              {clinical?.allergies.items && clinical.allergies.items.length > 0 ? (
                <div className="mt-3 space-y-1">
                  {clinical.allergies.items.map((item, idx) => (
                    <div
                      key={idx}
                      className="rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                    >
                      <strong>{item.substance}</strong>: {item.reaction ?? 'Reaction unspecified'}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  No known specific drug or food allergies recorded.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Visit medical history</CardTitle>
              <CardDescription>
                Consultations grouped by date, appointment session, and attending doctor. Expand a visit to review the clinical note.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {visitsByDate.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No consultations recorded for this patient yet.
                </p>
              ) : (
                visitsByDate.map((day) => (
                  <div key={day.date} className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="size-4 text-primary" />
                      <h3 className="text-sm font-semibold text-foreground">{formatSessionDate(day.date)}</h3>
                      <span className="text-xs text-muted-foreground">
                        {day.sessions.reduce((count, session) => count + session.encounters.length, 0)} visit
                        {day.sessions.reduce((count, session) => count + session.encounters.length, 0) === 1 ? '' : 's'}
                      </span>
                    </div>

                    {day.sessions.map((session) => (
                      <div key={session.sessionId} className="overflow-hidden rounded-xl border border-border bg-card">
                        <div className="border-b border-border bg-muted/40 px-4 py-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="font-medium text-foreground">{session.doctorName}</p>
                              <p className="text-xs text-muted-foreground">
                                {session.doctorSpecialization ? `${session.doctorSpecialization} · ` : ''}
                                Session {formatSessionTime(session.startAt)} – {formatSessionTime(session.endAt)}
                              </p>
                            </div>
                            <Badge tone="default">Appointment session</Badge>
                          </div>
                        </div>

                        <div className="divide-y divide-border">
                          {session.encounters.map((encounter, index) => (
                            <Collapsible key={encounter.id} defaultOpen={day.date === visitsByDate[0]?.date && index === 0}>
                              <CollapsibleTrigger className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/30">
                                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
                                <div className="min-w-0 flex-1">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-foreground">
                                      Queue {encounter.queue_display || String(encounter.queue_number).padStart(3, '0')}
                                    </span>
                                    <Badge tone={statusTone(encounter.status)}>{encounter.status}</Badge>
                                    {encounter.prescription ? (
                                      <Badge tone={encounter.prescription.status === 'SIGNED' ? 'active' : 'pending'}>
                                        Rx {encounter.prescription.status}
                                      </Badge>
                                    ) : null}
                                  </div>
                                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                    {encounter.booking_reference}
                                    {encounter.chief_complaint ? ` · ${encounter.chief_complaint}` : ' · No chief complaint recorded'}
                                  </p>
                                </div>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {encounter.signed_at
                                    ? new Date(encounter.signed_at).toLocaleString()
                                    : new Date(encounter.created_at).toLocaleString()}
                                </span>
                              </CollapsibleTrigger>

                              <CollapsibleContent>
                                <div className="space-y-3 border-t border-border bg-muted/10 px-4 py-4">
                                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                    <span className="rounded-md border border-border bg-background px-2 py-1">
                                      Doctor: {encounter.doctor_name}
                                    </span>
                                    <span className="rounded-md border border-border bg-background px-2 py-1">
                                      Date: {formatSessionDate(String(encounter.session_date).slice(0, 10))}
                                    </span>
                                    <span className="rounded-md border border-border bg-background px-2 py-1">
                                      Appointment: {encounter.appointment_status}
                                    </span>
                                  </div>

                                  {encounter.latest_vitals ? (
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                      <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">BP</p>
                                        <p className="text-sm font-semibold">
                                          {encounter.latest_vitals.systolic_mmhg ?? '—'}/
                                          {encounter.latest_vitals.diastolic_mmhg ?? '—'}
                                        </p>
                                      </div>
                                      <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pulse</p>
                                        <p className="text-sm font-semibold">{encounter.latest_vitals.pulse_bpm ?? '—'}</p>
                                      </div>
                                      <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Temp</p>
                                        <p className="text-sm font-semibold">{encounter.latest_vitals.temperature_c ?? '—'}</p>
                                      </div>
                                      <div className="rounded-lg border border-border bg-background px-3 py-2 text-center">
                                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Recorded</p>
                                        <p className="text-xs font-medium">
                                          {new Date(encounter.latest_vitals.recorded_at).toLocaleTimeString([], {
                                            hour: '2-digit',
                                            minute: '2-digit',
                                          })}
                                        </p>
                                      </div>
                                    </div>
                                  ) : null}

                                  <div className="grid gap-3 md:grid-cols-2">
                                    {noteField('Chief complaint', encounter.chief_complaint)}
                                    {noteField('History of present illness', encounter.history_present_illness)}
                                    {noteField('Examination findings', encounter.examination_findings)}
                                    {noteField('Assessment / diagnosis', encounter.assessment)}
                                    {noteField('Treatment plan', encounter.treatment_plan)}
                                    {noteField('Follow-up', encounter.follow_up_instructions)}
                                  </div>

                                  {!encounter.chief_complaint &&
                                  !encounter.history_present_illness &&
                                  !encounter.examination_findings &&
                                  !encounter.assessment &&
                                  !encounter.treatment_plan &&
                                  !encounter.follow_up_instructions ? (
                                    <p className="text-sm text-muted-foreground">No clinical notes were recorded for this visit.</p>
                                  ) : null}

                                  {encounter.prescription?.status === 'SIGNED' && encounter.prescription.items?.length ? (
                                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                        Prescription
                                      </p>
                                      <div className="mt-1.5 divide-y divide-border">
                                        {encounter.prescription.items.map((item, itemIndex) => (
                                          <div
                                            key={`${item.medicine_name}-${itemIndex}`}
                                            className="grid gap-1 py-1.5 text-sm sm:grid-cols-4"
                                          >
                                            <p className="font-medium text-foreground">{item.medicine_name}</p>
                                            <p className="text-muted-foreground">{item.dose}</p>
                                            <p className="text-muted-foreground">{item.frequency}</p>
                                            <p className="text-muted-foreground">{item.instructions || '—'}</p>
                                          </div>
                                        ))}
                                      </div>
                                      {encounter.prescription.clinical_instructions ? (
                                        <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground">
                                          <span className="font-medium text-foreground">Additional notes:</span>{' '}
                                          {encounter.prescription.clinical_instructions}
                                        </p>
                                      ) : null}
                                    </div>
                                  ) : null}

                                  <div className="flex flex-wrap gap-2 pt-1">
                                    {user?.role === 'clinic_doctor' &&
                                    (encounter.status === 'SIGNED' || encounter.status === 'DRAFT') ? (
                                      <Button asChild size="sm" variant="outline">
                                        <Link to={`/consultations/${encounter.id}`}>
                                          <FileText className="mr-1.5 size-3.5" />
                                          Open consultation
                                        </Link>
                                      </Button>
                                    ) : null}
                                    {encounter.prescription?.status === 'SIGNED' ? (
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        onClick={() =>
                                          void openProtectedDocument(
                                            `/clinic/prescriptions/${encounter.prescription!.id}/print`,
                                            { autoPrint: true },
                                          ).catch((err) => {
                                            const message =
                                              err instanceof ApiError
                                                ? err.message
                                                : err instanceof Error
                                                  ? err.message
                                                  : 'Unable to open prescription';
                                            setError(message);
                                            notify.error(message);
                                          })
                                        }
                                      >
                                        Print prescription PDF
                                      </Button>
                                    ) : null}
                                  </div>
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ))
              )}

              {clinical?.history && clinical.history.length > 0 ? (
                <div className="space-y-2 border-t border-border pt-4">
                  <h3 className="text-sm font-semibold text-foreground">Background medical notes</h3>
                  {clinical.history.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone="default">{item.category}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(item.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1 text-foreground">{item.summary}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: BILLING & INVOICES */}
        <TabsContent value="billing">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <div>
                <CardTitle className="text-base">Invoices & Settlement Registry</CardTitle>
                <CardDescription>Past invoices, payments received, and outstanding balances.</CardDescription>
              </div>
              <Link to="/billing/invoices?create=1">
                <Button size="sm">
                  <Plus className="size-3.5 mr-1" /> New Invoice
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="px-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Total (LKR)</TableHead>
                    <TableHead>Paid (LKR)</TableHead>
                    <TableHead>Balance (LKR)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                        No billing invoices created for this patient yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    invoices.map((inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium text-foreground">
                          <Link to={`/billing/invoices/${inv.id}`} className="hover:underline">
                            {inv.invoiceNumber ?? 'Draft invoice'}
                          </Link>
                        </TableCell>
                        <TableCell>{inv.invoiceTotal}</TableCell>
                        <TableCell>{inv.paid}</TableCell>
                        <TableCell className={inv.balance !== '0.00' ? 'font-semibold text-amber-700' : ''}>
                          {inv.balance}
                        </TableCell>
                        <TableCell>
                          <Badge tone={statusTone(inv.status === 'ISSUED' ? inv.settlement : inv.status)}>
                            {inv.status === 'ISSUED' ? inv.settlement : inv.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <PrintDocumentButton
                            path={`/clinic/invoices/${inv.id}/print`}
                            label="Print bill"
                            title={`Invoice ${inv.invoiceNumber ?? 'draft'}`}
                            description="Preview this bill on this page, then print or save it as a PDF."
                            className="h-8 text-xs"
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 5: SMS LOGS */}
        <TabsContent value="sms">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Outbound SMS History</CardTitle>
              <CardDescription>All automated SMS notifications dispatched to this patient.</CardDescription>
            </CardHeader>
            <CardContent className="px-0">
              {sms.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No SMS messages dispatched to this patient yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Notification Event</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Dispatched At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sms.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.eventType}</TableCell>
                        <TableCell className="font-mono text-xs">{row.recipientMasked}</TableCell>
                        <TableCell>
                          <Badge tone={statusTone(row.status)}>{row.status}</Badge>
                          {row.errorCategory ? (
                            <span className="block text-xs text-muted-foreground mt-0.5">{row.errorCategory}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(row.createdAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 6: AUDIT TRAIL */}
        <TabsContent value="audit">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Security & Compliance Audit Log</CardTitle>
            </CardHeader>
            <CardContent>
              {audit.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No audit entries recorded.</p>
              ) : (
                <ul className="space-y-2 text-xs">
                  {audit.map((item) => (
                    <li key={item.id} className="rounded-md border p-2.5 flex items-center justify-between">
                      <span className="font-medium text-foreground">{item.action}</span>
                      <span className="text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
