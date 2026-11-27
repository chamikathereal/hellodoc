import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SessionsCalendarView } from '@/features/sessions/components/SessionsCalendarView';
import {
  addDaysIso,
  clinicTodayIso,
  startOfWeekIso,
} from '@/features/sessions/utils/session-formatters';
import { api, ApiError } from '@/lib/api';
import type { ConsultationSession } from '@/lib/clinic-types';

/** Doctor's own consultation sessions in a week calendar that can be moved between weeks. */
export function DoctorCalendarPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeekIso(clinicTodayIso()));
  const [sessions, setSessions] = useState<ConsultationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      status: 'ALL',
      from: weekStart,
      to: addDaysIso(weekStart, 6),
      limit: '200',
    });
    api<{ items: ConsultationSession[] }>(`/doctor/sessions?${params}`)
      .then((res) => {
        if (!cancelled) setSessions(res.items);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load sessions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekStart]);

  const activeCount = sessions.filter((s) => s.status !== 'CANCELLED').length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">My calendar</h1>
        <p className="text-sm text-muted-foreground">
          Your consultation sessions by date. Use the arrows to move between weeks.
        </p>
      </div>
      <Card className="shadow-none">
        <CardContent className="space-y-3 pt-5">
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <SessionsCalendarView sessions={sessions} weekStart={weekStart} onWeekChange={setWeekStart} />
          {loading ? (
            <Skeleton className="h-4 w-48" />
          ) : !error ? (
            <p className="text-xs text-muted-foreground">
              {activeCount === 0
                ? 'No sessions this week.'
                : `${activeCount} session(s) this week.`}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
