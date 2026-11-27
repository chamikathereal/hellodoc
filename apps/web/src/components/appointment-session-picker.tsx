import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TablePagination } from '@/components/ui/table-pagination';
import { SessionStatusBadge } from '@/features/sessions/components/SessionStatusBadge';
import {
  addDaysIso,
  clinicTodayIso,
  formatSessionDate,
  formatSessionTime,
  startOfWeekIso,
} from '@/features/sessions/utils/session-formatters';
import { api, ApiError } from '@/lib/api';
import type { ConsultationSession } from '@/lib/clinic-types';
import { cn } from '@/lib/utils';

const PAGE_LIMIT = 200;
const MAX_PAGES = 10;

/**
 * Lists one doctor's consultation sessions so staff can pick a session and see only its
 * appointments. Shows the current week by default, with "View all" for every session.
 */
export function AppointmentSessionPicker({
  doctorId,
  selectedSessionId,
  onSelect,
  refreshKey,
}: {
  doctorId: string;
  selectedSessionId: string;
  onSelect: (session: ConsultationSession) => void;
  refreshKey?: number;
}) {
  const today = clinicTodayIso();
  const weekStart = startOfWeekIso(today);
  const weekEnd = addDaysIso(weekStart, 6);
  const [sessions, setSessions] = useState<ConsultationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(12);

  useEffect(() => {
    setShowAll(false);
    setOffset(0);
  }, [doctorId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const all: ConsultationSession[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          doctorId,
          status: 'ALL',
          limit: String(PAGE_LIMIT),
          offset: String(page * PAGE_LIMIT),
        });
        const res = await api<{ items: ConsultationSession[] }>(`/clinic/sessions?${params}`);
        all.push(...res.items);
        if (res.items.length < PAGE_LIMIT) break;
      }
      return all;
    })()
      .then((all) => {
        if (!cancelled) setSessions(all);
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
  }, [doctorId, refreshKey]);

  const thisWeek = useMemo(
    () => sessions.filter((s) => s.localDate >= weekStart && s.localDate <= weekEnd),
    [sessions, weekStart, weekEnd],
  );

  // "View all": today and upcoming first (soonest first), then past sessions (most recent first).
  const allOrdered = useMemo(() => {
    const upcoming = sessions.filter((s) => s.localDate >= today);
    const past = sessions.filter((s) => s.localDate < today).reverse();
    return [...upcoming, ...past];
  }, [sessions, today]);

  const visible = showAll ? allOrdered.slice(offset, offset + limit) : thisWeek;

  if (loading) {
    return (
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Sessions</p>
          <p className="text-xs text-muted-foreground">
            {showAll
              ? `All sessions (${sessions.length}) · upcoming first`
              : `This week (${weekStart} → ${weekEnd})`}
            {' · Select a session to see its appointments'}
          </p>
        </div>
        {sessions.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setShowAll((prev) => !prev);
              setOffset(0);
            }}
          >
            {showAll ? 'Show this week only' : `View all (${sessions.length})`}
          </Button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">
          {sessions.length === 0
            ? 'This doctor has no sessions.'
            : 'No sessions this week. Use “View all” to see other sessions.'}
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {visible.map((session) => {
            const selected = session.id === selectedSessionId;
            return (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session)}
                aria-pressed={selected}
                className={cn(
                  'flex flex-col gap-1 rounded-md border bg-card px-3 py-2 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer',
                  selected && 'border-primary ring-1 ring-primary/40 bg-primary/5',
                  session.localDate === today && !selected && 'border-primary/40',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-foreground">{formatSessionDate(session.localDate)}</span>
                  <SessionStatusBadge status={session.status} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {formatSessionTime(session.startAt, session.endAt, session.timezone)}
                </span>
                <span className="text-xs text-muted-foreground">Capacity {session.capacity}</span>
              </button>
            );
          })}
        </div>
      )}

      {showAll && allOrdered.length > 0 ? (
        <TablePagination
          total={allOrdered.length}
          limit={limit}
          offset={offset}
          pageSizeOptions={[12, 24, 48]}
          onPageChange={setOffset}
          onLimitChange={(next) => {
            setLimit(next);
            setOffset(0);
          }}
        />
      ) : null}
    </div>
  );
}
