import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
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
import { SessionsCalendarView } from '@/features/sessions/components/SessionsCalendarView';
import {
  addDaysIso,
  clinicTodayIso,
  formatSessionDate,
  formatSessionTime,
  startOfWeekIso,
} from '@/features/sessions/utils/session-formatters';
import { api, ApiError } from '@/lib/api';
import type { ConsultationSession } from '@/lib/clinic-types';

const PAGE_LIMIT = 200;
const MAX_PAGES = 10;

/**
 * Upcoming sessions for one doctor: the current week by default, "View all" for the full list,
 * and a week calendar view that can be moved between weeks.
 */
export function DoctorUpcomingSessionsCard({
  doctorId,
  refreshKey,
}: {
  doctorId: string;
  /** Change this to reload (e.g. after a schedule change). */
  refreshKey?: number;
}) {
  const navigate = useNavigate();
  const today = clinicTodayIso();
  const thisWeekStart = startOfWeekIso(today);
  const [sessions, setSessions] = useState<ConsultationSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const [showAll, setShowAll] = useState(false);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(10);
  const [weekStart, setWeekStart] = useState(thisWeekStart);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const all: ConsultationSession[] = [];
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          doctorId,
          status: 'SCHEDULED',
          from: clinicTodayIso(),
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
        if (cancelled) return;
        const now = Date.now();
        setSessions(all.filter((s) => new Date(s.startAt).getTime() > now));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Failed to load upcoming sessions');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [doctorId, refreshKey]);

  const thisWeekEnd = addDaysIso(thisWeekStart, 6);
  const thisWeekSessions = useMemo(
    () => sessions.filter((s) => s.localDate <= thisWeekEnd),
    [sessions, thisWeekEnd],
  );
  const calendarSessions = useMemo(() => {
    const end = addDaysIso(weekStart, 6);
    return sessions.filter((s) => s.localDate >= weekStart && s.localDate <= end);
  }, [sessions, weekStart]);

  const listRows = showAll ? sessions.slice(offset, offset + limit) : thisWeekSessions;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Upcoming sessions</h2>
          <p className="text-xs text-muted-foreground">
            {view === 'calendar'
              ? 'Week view · Asia/Colombo'
              : showAll
                ? `All upcoming sessions (${sessions.length})`
                : `This week (${thisWeekStart} → ${thisWeekEnd})`}
          </p>
        </div>
        <div className="flex items-center rounded-md border border-border bg-muted/40 p-0.5">
          <Button
            type="button"
            size="sm"
            variant={view === 'list' ? 'default' : 'ghost'}
            onClick={() => setView('list')}
          >
            <List className="size-4" />
            List
          </Button>
          <Button
            type="button"
            size="sm"
            variant={view === 'calendar' ? 'default' : 'ghost'}
            onClick={() => {
              setWeekStart(thisWeekStart);
              setView('calendar');
            }}
          >
            <LayoutGrid className="size-4" />
            Calendar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-2/3" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : view === 'calendar' ? (
          <SessionsCalendarView
            sessions={calendarSessions}
            weekStart={weekStart}
            onWeekChange={setWeekStart}
            onSelectSession={(id) => navigate(`/sessions/${id}`)}
          />
        ) : (
          <>
            {listRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {showAll || sessions.length === 0
                  ? 'No upcoming sessions.'
                  : 'No more sessions this week.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Capacity</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {listRows.map((session) => (
                      <TableRow key={session.id}>
                        <TableCell className="font-medium">{formatSessionDate(session.localDate)}</TableCell>
                        <TableCell>{formatSessionTime(session.startAt, session.endAt, session.timezone)}</TableCell>
                        <TableCell>{session.capacity}</TableCell>
                        <TableCell>
                          <Link to={`/sessions/${session.id}`}>
                            <Button size="sm" variant="outline" type="button">
                              View
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {showAll && sessions.length > 0 ? (
              <TablePagination
                total={sessions.length}
                limit={limit}
                offset={offset}
                onPageChange={setOffset}
                onLimitChange={(next) => {
                  setLimit(next);
                  setOffset(0);
                }}
              />
            ) : null}
            {sessions.length > 0 ? (
              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setShowAll((prev) => !prev);
                    setOffset(0);
                  }}
                >
                  {showAll ? 'Show this week only' : `View all (${sessions.length})`}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
