import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import type { ConsultationSession, Doctor } from '@/lib/clinic-types';
import {
  CreateSessionDialog,
  type CreateSessionDefaults,
} from '../components/CreateSessionDialog';
import { SessionDetailDialog } from '../components/SessionDetailDialog';
import { OpenSessionsPanel } from '../components/OpenSessionsPanel';
import { SessionEmptyState } from '../components/SessionEmptyState';
import { SessionsCalendarView } from '../components/SessionsCalendarView';
import { SessionsDataTable, type SessionRow } from '../components/SessionsDataTable';
import { SessionsPageHeader } from '../components/SessionsPageHeader';
import {
  SessionsSummaryCards,
  type SessionsSummary,
} from '../components/SessionsSummaryCards';
import { SessionsToolbar } from '../components/SessionsToolbar';
import { useSessionFilters } from '../hooks/useSessionFilters';
import {
  addDaysIso,
  clinicTodayIso,
  startOfWeekIso,
} from '../utils/session-formatters';

export function SessionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { filters, patch, reset } = useSessionFilters();
  const [items, setItems] = useState<ConsultationSession[]>([]);
  const [summarySource, setSummarySource] = useState<ConsultationSession[]>([]);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeekIso(clinicTodayIso()));
  const [hasEverLoaded, setHasEverLoaded] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDefaults, setCreateDefaults] = useState<CreateSessionDefaults>({});

  // Session Detail / Edit Dialog state
  const detailId = searchParams.get('detail');
  const isEdit = searchParams.get('edit') === '1';
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [startInEdit, setStartInEdit] = useState(false);

  useEffect(() => {
    if (detailId) {
      setSelectedSessionId(detailId);
      setStartInEdit(isEdit);
      setDetailOpen(true);
    }
  }, [detailId, isEdit]);

  const openSessionDetail = useCallback(
    (sessionId: string, edit = false) => {
      setSelectedSessionId(sessionId);
      setStartInEdit(edit);
      setDetailOpen(true);
      const next = new URLSearchParams(searchParams);
      next.set('detail', sessionId);
      if (edit) next.set('edit', '1');
      else next.delete('edit');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const closeSessionDetail = useCallback(
    (open: boolean) => {
      setDetailOpen(open);
      if (!open) {
        setSelectedSessionId(null);
        setStartInEdit(false);
        const next = new URLSearchParams(searchParams);
        next.delete('detail');
        next.delete('edit');
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams],
  );

  const openCreate = useCallback((defaults: CreateSessionDefaults = {}) => {
    setCreateDefaults(defaults);
    setCreateOpen(true);
  }, []);

  const closeCreate = useCallback(
    (open: boolean) => {
      setCreateOpen(open);
      if (!open) {
        const next = new URLSearchParams(searchParams);
        next.delete('create');
        next.delete('doctorId');
        next.delete('date');
        setSearchParams(next, { replace: true });
        setCreateDefaults({});
      }
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    if (searchParams.get('create') !== '1') return;
    openCreate({
      doctorId: searchParams.get('doctorId') ?? undefined,
      date: searchParams.get('date') ?? undefined,
    });
  }, [searchParams, openCreate]);

  const doctorMap = useMemo(() => {
    const map = new Map<string, Doctor>();
    for (const d of doctors) map.set(d.id, d);
    return map;
  }, [doctors]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const today = clinicTodayIso();
      const listParams = new URLSearchParams({
        // "Open" includes paused sessions: both are in progress.
        status: filters.status === 'OPEN' ? 'OPEN,PAUSED' : filters.status,
        limit: '200',
        from: filters.from,
        to: filters.to,
      });
      if (filters.doctorId) listParams.set('doctorId', filters.doctorId);

      const summaryParams = new URLSearchParams({
        status: 'ALL',
        limit: '200',
        from: today,
        to: addDaysIso(today, 90),
      });

      const [sessions, doctorList, summarySessions] = await Promise.all([
        api<{ items: ConsultationSession[] }>(`/clinic/sessions?${listParams}`),
        api<{ items: Doctor[] }>('/clinic/doctors?status=ALL&limit=100'),
        api<{ items: ConsultationSession[] }>(`/clinic/sessions?${summaryParams}`),
      ]);
      setItems(sessions.items);
      setDoctors(doctorList.items);
      setSummarySource(summarySessions.items);
      setHasEverLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [filters.status, filters.from, filters.to, filters.doctorId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (filters.view === 'calendar') {
      setWeekStart(startOfWeekIso(filters.from || clinicTodayIso()));
    }
  }, [filters.view, filters.from]);

  const filteredRows: SessionRow[] = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return items
      .filter((session) => {
        if (!q) return true;
        return (session.doctorDisplayName ?? '').toLowerCase().includes(q);
      })
      .map((session) => ({
        ...session,
        specialization: doctorMap.get(session.doctorId)?.specialization ?? null,
      }));
  }, [items, filters.q, doctorMap]);

  const summary: SessionsSummary | null = useMemo(() => {
    if (!hasEverLoaded) return null;
    const today = clinicTodayIso();
    const now = Date.now();
    let todayCount = 0;
    let upcomingCount = 0;
    let scheduledCapacity = 0;
    let cancelledCount = 0;
    let openCount = 0;
    for (const s of summarySource) {
      // Matches the "Open" status filter: open or paused sessions.
      if (s.status === 'OPEN' || s.status === 'PAUSED') openCount += 1;
      if (s.status === 'CANCELLED') {
        cancelledCount += 1;
        continue;
      }
      if (s.status !== 'SCHEDULED') continue;
      if (s.localDate === today) todayCount += 1;
      if (new Date(s.startAt).getTime() > now) {
        upcomingCount += 1;
        scheduledCapacity += s.capacity;
      }
    }
    return {
      todayCount,
      upcomingCount,
      scheduledCapacity,
      cancelledCount,
      openCount,
      rangeLabel: `Next 90 days from ${today}`,
    };
  }, [summarySource, hasEverLoaded]);

  const calendarSessions = useMemo(() => {
    const weekEnd = addDaysIso(weekStart, 6);
    return filteredRows.filter(
      (s) => s.localDate >= weekStart && s.localDate <= weekEnd,
    );
  }, [filteredRows, weekStart]);

  const pageIndex = Math.max(0, filters.page - 1);

  return (
    <div className="space-y-5">
      <SessionsPageHeader onCreate={() => openCreate()} />
      <SessionsSummaryCards
        summary={summary}
        loading={loading && !hasEverLoaded}
        openActive={filters.status === 'OPEN'}
        onOpenSessionsClick={() => {
          const today = clinicTodayIso();
          patch({ status: 'OPEN', from: today, to: addDaysIso(today, 90), view: 'list', q: '' });
        }}
      />

      <Card className="shadow-none">
        <CardContent className="space-y-4 pt-5">
          <SessionsToolbar
            filters={filters}
            doctors={doctors.filter((d) => d.status === 'ACTIVE' || d.id === filters.doctorId)}
            onChange={(next) => patch(next)}
            onApply={() => void load()}
            onReset={reset}
          />

          {error ? (
            <Alert variant="destructive">
              <AlertCircle className="size-4" />
              <AlertTitle>Unable to load sessions</AlertTitle>
              <AlertDescription className="flex flex-wrap items-center gap-3">
                <span>{error}</span>
                <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>
                  Retry
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {loading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-2/3" />
            </div>
          ) : null}

          {!loading && !error && filteredRows.length === 0 ? (
            <SessionEmptyState
              variant={hasEverLoaded && items.length === 0 && !filters.q ? 'empty' : 'filtered'}
              onReset={reset}
              onCreate={() => openCreate()}
            />
          ) : null}

          {!loading && !error && filteredRows.length > 0 && filters.view === 'list' && filters.status === 'OPEN' ? (
            <OpenSessionsPanel
              sessions={filteredRows}
              onSelectSession={(id) => openSessionDetail(id, false)}
            />
          ) : null}

          {!loading && !error && filteredRows.length > 0 && filters.view === 'list' && filters.status !== 'OPEN' ? (
            <SessionsDataTable
              data={filteredRows}
              pageIndex={pageIndex}
              pageSize={filters.pageSize}
              onPageChange={(page) => patch({ page }, { resetPage: false })}
              onPageSizeChange={(pageSize) => patch({ pageSize, page: 1 })}
              onCreate={() => openCreate()}
              onSelectSession={(id, edit) => openSessionDetail(id, edit)}
              onCancel={async (sessionId, reason) => {
                await api(`/clinic/sessions/${sessionId}/cancel`, {
                  method: 'POST',
                  json: { reason },
                });
                await load();
              }}
            />
          ) : null}

          {!loading && !error && filters.view === 'calendar' ? (
            filteredRows.length === 0 ? null : (
              <SessionsCalendarView
                sessions={calendarSessions}
                weekStart={weekStart}
                onWeekChange={setWeekStart}
                onCreateDate={(date) => openCreate({ date })}
                onSelectSession={(id) => openSessionDetail(id, false)}
              />
            )
          ) : null}
        </CardContent>
      </Card>

      <CreateSessionDialog
        open={createOpen}
        onOpenChange={closeCreate}
        defaults={createDefaults}
        onCreated={() => void load()}
      />

      <SessionDetailDialog
        open={detailOpen}
        onOpenChange={closeSessionDetail}
        sessionId={selectedSessionId}
        initialEdit={startInEdit}
        onUpdated={() => void load()}
      />
    </div>
  );
}
