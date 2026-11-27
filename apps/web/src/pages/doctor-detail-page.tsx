import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Key, Link as LinkIcon, UserPlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DoctorUpcomingSessionsCard } from '@/components/doctor-upcoming-sessions-card';
import { ScheduleTemplateBulkUpdateDialog } from '@/components/schedule-template-bulk-update-dialog';
import { ScheduleTemplateDeactivateDialog } from '@/components/schedule-template-deactivate-dialog';
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
import { api, ApiError } from '@/lib/api';
import type { Doctor, ScheduleTemplate } from '@/lib/clinic-types';
import { WEEKDAYS } from '@/lib/clinic-types';

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Mirrors the API rule: every booked patient must fit within the session time. */
function validateSchedule(
  startTime: string,
  endTime: string,
  capacity: number,
  duration: number,
): string | null {
  if (!startTime || !endTime) return 'Enter both a start time and an end time';
  const sessionMinutes = timeToMinutes(endTime) - timeToMinutes(startTime);
  if (sessionMinutes <= 0) return 'End time must be after start time';
  if (!Number.isInteger(capacity) || capacity < 1) {
    return 'Capacity must be a whole number of at least 1';
  }
  if (capacity > 500) return 'Capacity cannot be more than 500';
  if (!Number.isInteger(duration) || duration < 1) {
    return 'Duration must be a whole number of at least 1 minute';
  }
  if (duration > 240) return 'Duration cannot be more than 240 minutes';
  if (duration > sessionMinutes) {
    return `Duration (${duration} min) cannot be longer than the session (${sessionMinutes} min)`;
  }
  if (capacity * duration > sessionMinutes) {
    const maxCapacity = Math.floor(sessionMinutes / duration);
    return (
      `${capacity} patients × ${duration} min = ${capacity * duration} min, but the session is only ` +
      `${sessionMinutes} min. Reduce capacity to ${maxCapacity} or less, shorten the duration, or extend the session time.`
    );
  }
  return null;
}

export function DoctorDetailPage() {
  const { id } = useParams();
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [templates, setTemplates] = useState<ScheduleTemplate[]>([]);
  const [sessionsRefreshKey, setSessionsRefreshKey] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [scheduleMsg, setScheduleMsg] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 3, 5]);
  const [startTime, setStartTime] = useState('17:00');
  const [endTime, setEndTime] = useState('21:00');
  const [capacity, setCapacity] = useState(25);
  const [duration, setDuration] = useState(10);
  const [horizonOption, setHorizonOption] = useState<'30' | '60' | '90' | 'custom'>('90');
  const [customHorizonDays, setCustomHorizonDays] = useState(90);
  const [saving, setSaving] = useState(false);
  const [deactivatingTemplate, setDeactivatingTemplate] = useState<ScheduleTemplate | null>(null);
  const [bulkUpdatingTemplate, setBulkUpdatingTemplate] = useState<ScheduleTemplate | null>(null);

  // Doctor login modal state
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginPassword, setLoginPassword] = useState('DoctorPass123!');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginSuccess, setLoginSuccess] = useState(false);
  const [submittingLogin, setSubmittingLogin] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setError(null);
    try {
      const [d, t] = await Promise.all([
        api<Doctor>(`/clinic/doctors/${id}`),
        api<ScheduleTemplate[]>(`/clinic/doctors/${id}/schedule-templates`),
      ]);
      setDoctor(d);
      setTemplates(t);
      setSessionsRefreshKey((k) => k + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load doctor');
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const reviewCredentials = async (status: 'VERIFIED' | 'SUSPENDED') => {
    if (!doctor) return;
    setReviewing(true);
    setReviewError(null);
    try {
      await api(`/clinic/doctors/${doctor.id}/credential-review`, {
        method: 'POST',
        json: { status },
      });
      await load();
    } catch (err) {
      setReviewError(err instanceof ApiError ? err.message : 'Could not update signing status');
    } finally {
      setReviewing(false);
    }
  };

  const horizonDays = horizonOption === 'custom' ? customHorizonDays : Number(horizonOption);
  const horizonValid = Number.isInteger(horizonDays) && horizonDays >= 1 && horizonDays <= 365;

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!doctor) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{doctor.displayName}</h1>
          <p className="text-sm text-muted-foreground">{doctor.fullName}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={doctor.status === 'ACTIVE' ? 'active' : 'suspended'}>{doctor.status}</Badge>
            <Badge
              tone={
                doctor.credentialReviewStatus === 'VERIFIED'
                  ? 'active'
                  : doctor.credentialReviewStatus === 'SUSPENDED'
                    ? 'suspended'
                    : 'pending'
              }
            >
              {doctor.credentialReviewStatus === 'VERIFIED'
                ? 'Verified to sign'
                : doctor.credentialReviewStatus === 'SUSPENDED'
                  ? 'Signing suspended'
                  : 'Pending verification'}
            </Badge>
            {doctor.credentialReviewStatus === 'VERIFIED' ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={reviewing}
                onClick={() => void reviewCredentials('SUSPENDED')}
              >
                Suspend signing
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                disabled={reviewing}
                onClick={() => void reviewCredentials('VERIFIED')}
              >
                Verify for signing
              </Button>
            )}
          </div>
          {reviewError ? <p className="mt-2 text-sm text-destructive">{reviewError}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={!doctor.email}
            onClick={() => {
              setLoginModalOpen(true);
              setLoginSuccess(false);
              setLoginError(null);
            }}
            className="gap-1.5 cursor-pointer"
          >
            <Key className="size-3.5 text-primary" />
            Create Doctor Login
          </Button>
          <Link to={`/doctors?edit=${doctor.id}`}>
            <Button type="button" variant="secondary">Edit Profile</Button>
          </Link>
          <Link to={`/sessions?create=1&doctorId=${doctor.id}`}>
            <Button type="button">Create Session</Button>
          </Link>
        </div>
      </div>

      {/* Doctor Login Creation Dialog */}
      <Dialog open={loginModalOpen} onOpenChange={setLoginModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <UserPlus className="size-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">Doctor Login Credentials</DialogTitle>
                <DialogDescription className="text-xs">
                  Configure doctor portal access for {doctor.displayName}.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {loginSuccess ? (
            <div className="space-y-4 py-2">
              <div className="flex flex-col items-center justify-center text-center p-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-950 dark:text-emerald-200">
                <CheckCircle2 className="size-10 text-emerald-600 dark:text-emerald-400 mb-2" />
                <p className="font-bold text-sm">Doctor Login Created Successfully!</p>
                <p className="text-xs text-muted-foreground mt-1">
                  The doctor can now sign in at the login page and access the clinical worklist.
                </p>
              </div>

              <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Login URL:</span>
                  <span className="font-semibold">{window.location.origin}/login</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Email:</span>
                  <span className="font-semibold">{doctor.email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Password:</span>
                  <span className="font-semibold text-primary">{loginPassword}</span>
                </div>
              </div>

              <DialogFooter>
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => setLoginModalOpen(false)}
                >
                  Done
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2 text-xs">
              {loginError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2.5 text-destructive">
                  {loginError}
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Doctor Account Email</Label>
                <Input value={doctor.email ?? ''} readOnly className="h-8 font-mono text-xs bg-muted/40" />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Set Initial Password *</Label>
                <Input
                  type="text"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="At least 10 chars, uppercase, number & symbol"
                  className="h-8 font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Minimum 10 characters (e.g. <code>DoctorPass123!</code>).
                </p>
              </div>

              <div className="pt-2 flex flex-col gap-2">
                <Button
                  type="button"
                  disabled={submittingLogin || !loginPassword}
                  onClick={async () => {
                    if (!doctor?.id || !doctor?.email) return;
                    if (loginPassword.length < 10) {
                      setLoginError('Password must be at least 10 characters long');
                      return;
                    }
                    setSubmittingLogin(true);
                    setLoginError(null);
                    try {
                      // 1. Generate invitation
                      const inv = await api<{ acceptUrl: string }>(`/clinic/doctors/${doctor.id}/invitations`, {
                        method: 'POST',
                        json: { email: doctor.email },
                      });
                      const token = new URL(inv.acceptUrl).searchParams.get('token');
                      if (!token) throw new Error('Failed to retrieve invite token');

                      // 2. Accept and create doctor account directly
                      await api('/doctor/invitations/accept', {
                        method: 'POST',
                        json: {
                          token,
                          name: doctor.displayName || doctor.fullName,
                          password: loginPassword,
                        },
                      });

                      setLoginSuccess(true);
                    } catch (err) {
                      setLoginError(err instanceof ApiError ? err.message : 'Failed to create doctor login');
                    } finally {
                      setSubmittingLogin(false);
                    }
                  }}
                  className="w-full font-semibold cursor-pointer gap-2"
                >
                  <Key className="size-3.5" />
                  {submittingLogin ? 'Creating Account...' : 'Create Doctor Login Now'}
                </Button>

                <div className="relative my-2 text-center text-[11px] text-muted-foreground after:absolute after:top-1/2 after:left-0 after:right-0 after:h-px after:bg-border">
                  <span className="relative z-10 bg-background px-2">OR</span>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  disabled={inviting}
                  onClick={async () => {
                    if (!doctor?.id || !doctor?.email) return;
                    setInviting(true);
                    setLoginError(null);
                    try {
                      const res = await api<{ acceptUrl: string }>(`/clinic/doctors/${doctor.id}/invitations`, {
                        method: 'POST',
                        json: { email: doctor.email },
                      });
                      setInviteUrl(res.acceptUrl);
                      void navigator.clipboard.writeText(res.acceptUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 3000);
                    } catch (err) {
                      setLoginError(err instanceof ApiError ? err.message : 'Could not generate invitation link');
                    } finally {
                      setInviting(false);
                    }
                  }}
                  className="w-full text-xs gap-1.5 cursor-pointer"
                >
                  {copied ? (
                    <>
                      <CheckCircle2 className="size-3.5 text-emerald-600" />
                      Link Copied to Clipboard!
                    </>
                  ) : (
                    <>
                      <LinkIcon className="size-3.5" />
                      {inviting ? 'Generating...' : 'Copy Invite Link to Send to Doctor'}
                    </>
                  )}
                </Button>

                {inviteUrl ? (
                  <div className="rounded border border-teal-500/30 bg-teal-500/10 p-2 font-mono text-[11px] break-all text-teal-900 dark:text-teal-200">
                    {inviteUrl}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><h2 className="font-semibold">Profile</h2></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><span className="text-muted-foreground">Registration:</span> {doctor.registrationNumber ?? '—'}</p>
            <p><span className="text-muted-foreground">Specialization:</span> {doctor.specialization ?? '—'}</p>
            <p><span className="text-muted-foreground">Qualifications:</span> {doctor.qualifications ?? '—'}</p>
            <p><span className="text-muted-foreground">Phone:</span> {doctor.contactNumber ?? '—'}</p>
            <p><span className="text-muted-foreground">Email:</span> {doctor.email ?? '—'}</p>
          </CardContent>
        </Card>

        <div className="lg:col-span-2">
          <DoctorUpcomingSessionsCard doctorId={doctor.id} refreshKey={sessionsRefreshKey} />
        </div>
      </div>

      <Card>
        <CardHeader>
          <h2 className="font-semibold">Manage weekly schedule</h2>
          <p className="text-sm text-slate-600">
            Save weekdays and generate consultation sessions for the period you choose.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            {WEEKDAYS.map((day) => (
              <label key={day.value} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selectedDays.includes(day.value)}
                  onChange={(e) => {
                    setSelectedDays((prev) =>
                      e.target.checked
                        ? [...prev, day.value]
                        : prev.filter((v) => v !== day.value),
                    );
                  }}
                />
                {day.label}
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label>Start</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <Label>End</Label>
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </div>
            <div>
              <Label>Capacity</Label>
              <Input
                type="number"
                min={1}
                max={500}
                step={1}
                value={capacity}
                onChange={(e) => setCapacity(e.target.value === '' ? Number.NaN : Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Duration (min)</Label>
              <Input
                type="number"
                min={1}
                max={240}
                step={1}
                value={duration}
                onChange={(e) => setDuration(e.target.value === '' ? Number.NaN : Number(e.target.value))}
              />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <Label htmlFor="schedule-horizon">Generate sessions for</Label>
              <select
                id="schedule-horizon"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs focus:outline-hidden focus:ring-1 focus:ring-ring"
                value={horizonOption}
                onChange={(e) => setHorizonOption(e.target.value as typeof horizonOption)}
              >
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            {horizonOption === 'custom' ? (
              <div>
                <Label htmlFor="schedule-horizon-days">Number of days (1–365)</Label>
                <Input
                  id="schedule-horizon-days"
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  value={Number.isNaN(customHorizonDays) ? '' : customHorizonDays}
                  onChange={(e) =>
                    setCustomHorizonDays(e.target.value === '' ? Number.NaN : Number(e.target.value))
                  }
                />
              </div>
            ) : null}
          </div>
          {scheduleError ? <p className="text-sm text-destructive">{scheduleError}</p> : null}
          {scheduleMsg ? <p className="text-sm text-primary">{scheduleMsg}</p> : null}
          <Button
            type="button"
            disabled={saving || selectedDays.length === 0 || doctor.status !== 'ACTIVE'}
            onClick={async () => {
              setScheduleMsg(null);
              const validationError = horizonValid
                ? validateSchedule(startTime, endTime, capacity, duration)
                : 'Generation period must be a whole number of days between 1 and 365';
              setScheduleError(validationError);
              if (validationError) return;
              setSaving(true);
              try {
                const today = new Date().toISOString().slice(0, 10);
                const result = await api<{
                  templates: ScheduleTemplate[];
                  materialize: { created: number; skippedExisting: number; skippedConflicts: number };
                }>(`/clinic/doctors/${doctor.id}/schedule-templates`, {
                  method: 'POST',
                  json: {
                    slots: selectedDays.map((weekday) => ({
                      weekday,
                      localStartTime: startTime,
                      localEndTime: endTime,
                    })),
                    effectiveFrom: today,
                    defaultCapacity: capacity,
                    expectedDurationMinutes: duration,
                    timezone: 'Asia/Colombo',
                    materialize: true,
                    horizonDays,
                  },
                });
                setScheduleMsg(
                  `Saved ${result.templates.length} template(s). Generated ${result.materialize?.created ?? 0} sessions` +
                    ` (${result.materialize?.skippedExisting ?? 0} existing, ${result.materialize?.skippedConflicts ?? 0} conflicts).`,
                );
                await load();
              } catch (err) {
                setScheduleError(err instanceof ApiError ? err.message : 'Failed to save schedule');
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving
              ? 'Saving…'
              : `Save schedule & generate ${horizonValid ? horizonDays : '…'} days`}
          </Button>

          {templates.length > 0 ? (
            <div className="space-y-3">
              <h3 className="font-medium">Current templates</h3>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Weekday</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">
                        {WEEKDAYS.find((d) => d.value === t.weekday)?.label}
                      </TableCell>
                      <TableCell>
                        {t.localStartTime}–{t.localEndTime}
                      </TableCell>
                      <TableCell>{t.defaultCapacity}</TableCell>
                      <TableCell>{t.expectedDurationMinutes} min</TableCell>
                      <TableCell>
                        <Badge tone={t.isActive ? 'active' : 'suspended'}>
                          {t.isActive ? 'ACTIVE' : 'INACTIVE'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {t.isActive ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={async () => {
                                setScheduleError(null);
                                try {
                                  const result = await api<{
                                    created: number;
                                    skippedConflicts: number;
                                    generatedThrough: string | null;
                                  }>(`/clinic/schedule-templates/${t.id}/materialize`, {
                                    method: 'POST',
                                    json: { horizonDays: 90 },
                                  });
                                  const through = result.generatedThrough
                                    ? ` Sessions now run until ${result.generatedThrough}.`
                                    : '';
                                  const conflicts = result.skippedConflicts
                                    ? ` ${result.skippedConflicts} date(s) skipped because they overlap existing sessions.`
                                    : '';
                                  setScheduleMsg(
                                    result.created > 0
                                      ? `Extended sessions: created ${result.created} new session(s).${through}${conflicts}`
                                      : `No new sessions created. Sessions are already generated as far ahead as allowed (up to 365 days).${through}${conflicts}`,
                                  );
                                  await load();
                                } catch (err) {
                                  setScheduleError(err instanceof ApiError ? err.message : 'Failed to extend sessions');
                                }
                              }}
                            >
                              Extend upcoming
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => {
                                setScheduleError(null);
                                setBulkUpdatingTemplate(t);
                              }}
                            >
                              Bulk update
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              type="button"
                              onClick={() => {
                                setScheduleError(null);
                                setDeactivatingTemplate(t);
                              }}
                            >
                              Deactivate
                            </Button>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            disabled={doctor.status !== 'ACTIVE'}
                            onClick={async () => {
                              setScheduleError(null);
                              try {
                                const result = await api<{
                                  materialize: { created: number; skippedConflicts: number };
                                }>(`/clinic/schedule-templates/${t.id}/activate`, {
                                  method: 'POST',
                                  json: {},
                                });
                                setScheduleMsg(
                                  `Template activated. Generated ${result.materialize?.created ?? 0} session(s)` +
                                    (result.materialize?.skippedConflicts
                                      ? ` (${result.materialize.skippedConflicts} skipped because they overlap existing sessions).`
                                      : '.'),
                                );
                                await load();
                              } catch (err) {
                                setScheduleError(err instanceof ApiError ? err.message : 'Failed to activate template');
                              }
                            }}
                          >
                            Activate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <ScheduleTemplateBulkUpdateDialog
        template={bulkUpdatingTemplate}
        onOpenChange={(open) => {
          if (!open) setBulkUpdatingTemplate(null);
        }}
        templateLabel={
          bulkUpdatingTemplate
            ? `${WEEKDAYS.find((d) => d.value === bulkUpdatingTemplate.weekday)?.label ?? ''} ${bulkUpdatingTemplate.localStartTime}–${bulkUpdatingTemplate.localEndTime}`
            : ''
        }
        onConfirm={async (newCapacity, newDuration) => {
          if (!bulkUpdatingTemplate) return;
          const result = await api<{
            updatedSessions: number;
            skipped: Array<{ date: string; reason: string }>;
          }>(`/clinic/schedule-templates/${bulkUpdatingTemplate.id}/bulk-update`, {
            method: 'POST',
            json: { capacity: newCapacity, expectedDurationMinutes: newDuration },
          });
          const skipped = result.skipped ?? [];
          setScheduleMsg(
            `Updated ${result.updatedSessions} upcoming session(s) to capacity ${newCapacity} and ${newDuration} min.` +
              (skipped.length
                ? ` ${skipped.length} session(s) were left unchanged: ${skipped.map((x) => `${x.date} (${x.reason})`).join('; ')}.`
                : ''),
          );
          await load();
        }}
      />

      <ScheduleTemplateDeactivateDialog
        open={deactivatingTemplate !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivatingTemplate(null);
        }}
        templateLabel={
          deactivatingTemplate
            ? `${WEEKDAYS.find((d) => d.value === deactivatingTemplate.weekday)?.label ?? ''} ${deactivatingTemplate.localStartTime}–${deactivatingTemplate.localEndTime}`
            : ''
        }
        onConfirm={async (reason) => {
          if (!deactivatingTemplate) return;
          const result = await api<{
            cancelledSessions: number;
            keptSessionsWithBookings: string[];
          }>(`/clinic/schedule-templates/${deactivatingTemplate.id}/deactivate`, {
            method: 'POST',
            json: { reason },
          });
          const kept = result.keptSessionsWithBookings ?? [];
          setScheduleMsg(
            `Template deactivated. Cancelled ${result.cancelledSessions ?? 0} upcoming session(s).` +
              (kept.length
                ? ` ${kept.length} session(s) with existing bookings were kept (${kept.join(', ')}). Review them in Sessions.`
                : ''),
          );
          await load();
        }}
      />
    </div>
  );
}
