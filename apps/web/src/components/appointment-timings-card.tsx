import { Card, CardContent, CardHeader } from '@/components/ui/card';
import type { Appointment } from '@/lib/clinic-types';
import { formatClinicDateTime, minutesBetween } from '@/lib/visit-timings';

/** Actual recorded times for one appointment: check-in, call, consultation start and end. */
export function AppointmentTimingsCard({ appointment }: { appointment: Appointment }) {
  const tz = appointment.timezone ?? undefined;
  const rows: Array<{ label: string; value: string }> = [
    { label: 'Checked in', value: formatClinicDateTime(appointment.checkedInAt, tz) },
    { label: 'Called', value: formatClinicDateTime(appointment.calledAt, tz) },
    { label: 'Consultation started', value: formatClinicDateTime(appointment.consultationStartedAt, tz) },
    { label: 'Consultation ended', value: formatClinicDateTime(appointment.consultationEndedAt, tz) },
    {
      label: 'Waiting time (check-in → start)',
      value: minutesBetween(appointment.checkedInAt, appointment.consultationStartedAt),
    },
    {
      label: 'Consultation duration',
      value: minutesBetween(appointment.consultationStartedAt, appointment.consultationEndedAt),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold">Visit timings</h2>
        <p className="text-xs text-muted-foreground">
          Recorded automatically from the queue · Asia/Colombo
        </p>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
        {rows.map((row) => (
          <p key={row.label}>
            <span className="text-muted-foreground">{row.label}:</span> {row.value}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
