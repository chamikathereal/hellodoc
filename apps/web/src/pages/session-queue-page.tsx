import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';

type QueueEntry = {
  id: string;
  appointmentId: string;
  queueNumber: number;
  queueDisplay: string;
  state: string;
  patientFullName: string | null;
  patientNumber: string | null;
  checkedInAt: string | null;
};

type QueueBoard = {
  revision: number;
  session: {
    id: string;
    doctorDisplayName: string | null;
    localDate: string;
    startAt: string;
    endAt: string;
    status: string;
    capacity: number;
  };
  currentCalled: QueueEntry | null;
  currentInService: QueueEntry | null;
  waiting: QueueEntry[];
  called: QueueEntry[];
  inService: QueueEntry[];
  completed: QueueEntry[];
  held: QueueEntry[];
  skipped: QueueEntry[];
  reserved: QueueEntry[];
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000/api';

export function SessionQueuePage() {
  const { id } = useParams();
  const [board, setBoard] = useState<QueueBoard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skipReason, setSkipReason] = useState('');
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [skipId, setSkipId] = useState<string | null>(null);
  const [connection, setConnection] = useState<'live' | 'polling' | 'offline'>('polling');
  const revisionRef = useRef(0);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api<QueueBoard>(`/clinic/sessions/${id}/queue`);
      setBoard(data);
      revisionRef.current = data.revision;
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load queue');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    let es: EventSource | null = null;
    let pollTimer: number | undefined;
    let stopped = false;

    const startPolling = () => {
      setConnection('polling');
      window.clearInterval(pollTimer);
      pollTimer = window.setInterval(() => {
        if (document.visibilityState === 'visible') void load();
      }, 12_000);
    };

    try {
      es = new EventSource(`${API_BASE}/clinic/sessions/${id}/queue/events`, {
        withCredentials: true,
      });
      es.onopen = () => setConnection('live');
      es.onmessage = () => {
        void load();
      };
      es.addEventListener('queue', () => void load());
      es.onerror = () => {
        es?.close();
        setConnection('polling');
        startPolling();
      };
    } catch {
      startPolling();
    }

    return () => {
      stopped = true;
      es?.close();
      window.clearInterval(pollTimer);
      void stopped;
    };
  }, [id, load]);

  const run = async (fn: () => Promise<QueueBoard>) => {
    setBusy(true);
    setError(null);
    try {
      const data = await fn();
      setBoard(data);
      revisionRef.current = data.revision;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (!board && !error) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (error && !board) return <p className="text-sm text-red-700">{error}</p>;
  if (!board) return null;

  // An open session can be completed manually; it also closes automatically after its end time.
  const canComplete = ['OPEN', 'PAUSED', 'DELAYED'].includes(board.session.status);
  const patientWithDoctor = board.called.length > 0 || board.inService.length > 0;
  const unseenCount = board.waiting.length + board.reserved.length + board.held.length + board.skipped.length;

  const EntryRow = ({
    entry,
    actions,
  }: {
    entry: QueueEntry;
    actions?: ReactNode;
  }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
      <div>
        <p className="font-mono text-lg font-semibold tracking-wide">#{entry.queueDisplay}</p>
        <p className="text-sm text-foreground">{entry.patientFullName}</p>
        <p className="font-mono text-xs text-muted-foreground">{entry.patientNumber}</p>
      </div>
      <div className="flex flex-wrap gap-2">{actions}</div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-primary uppercase">
            Clinic Management / Sessions / Queue
          </p>
          <h1 className="text-2xl font-semibold">{board.session.doctorDisplayName}</h1>
          <p className="text-sm text-muted-foreground">
            {board.session.localDate} · status {board.session.status}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={board.session.status === 'OPEN' ? 'active' : 'pending'}>
              {board.session.status}
            </Badge>
            <Badge tone="default">{connection}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to={`/sessions/${id}`}>
            <Button type="button" variant="outline">
              Session detail
            </Button>
          </Link>
          {board.session.status === 'SCHEDULED' || board.session.status === 'DELAYED' ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(() => api(`/clinic/sessions/${id}/open`, { method: 'POST', json: {} }))}
            >
              Open session
            </Button>
          ) : null}
          {board.session.status === 'OPEN' ? (
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  api(`/clinic/sessions/${id}/pause`, { method: 'POST', json: { reason: 'Paused by staff' } }),
                )
              }
            >
              Pause
            </Button>
          ) : null}
          {board.session.status === 'PAUSED' || board.session.status === 'DELAYED' ? (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void run(() => api(`/clinic/sessions/${id}/resume`, { method: 'POST', json: {} }))}
            >
              Resume
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={busy || board.session.status !== 'OPEN'}
            onClick={() =>
              void run(() => api(`/clinic/sessions/${id}/queue/call-next`, { method: 'POST', json: {} }))
            }
          >
            Call Next
          </Button>
          {canComplete ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy || patientWithDoctor}
              title={patientWithDoctor ? 'Finish the current consultation first' : undefined}
              onClick={() => setConfirmComplete(true)}
            >
              Complete session
            </Button>
          ) : null}
        </div>
      </div>

      {confirmComplete && canComplete ? (
        <Card className="border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
            <p>
              Complete this session and set it to <strong>Closed</strong>?
              {unseenCount > 0
                ? ` ${unseenCount} patient(s) not yet seen will be marked as no-show.`
                : ' All booked patients have been seen.'}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy}
                onClick={() => {
                  setConfirmComplete(false);
                  void run(() =>
                    api(`/clinic/sessions/${id}/close`, {
                      method: 'POST',
                      json: { unresolvedPolicy: 'MARK_NO_SHOW', note: 'Completed by staff' },
                    }),
                  );
                }}
              >
                Complete session
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setConfirmComplete(false)}>
                Keep open
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <h2 className="font-semibold">Now</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-lg bg-teal-500/10 p-4 text-center">
              <p className="text-xs uppercase tracking-wide text-primary">Called</p>
              <p className="text-4xl font-semibold text-primary">
                {board.currentCalled ? `#${board.currentCalled.queueDisplay}` : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-muted/40 p-4 text-center">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">In service</p>
              <p className="text-3xl font-semibold text-foreground">
                {board.currentInService ? `#${board.currentInService.queueDisplay}` : '—'}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <h2 className="font-semibold">Waiting ({board.waiting.length})</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {board.waiting.length === 0 ? (
              <p className="text-sm text-muted-foreground">No checked-in patients waiting.</p>
            ) : (
              board.waiting.map((entry) => (
                <EntryRow
                  key={entry.id}
                  entry={entry}
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api(`/clinic/queue/${entry.id}/hold`, {
                              method: 'POST',
                              json: { reason: 'Held by staff' },
                            }),
                          )
                        }
                      >
                        Hold
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setSkipId(entry.id)}
                      >
                        Skip
                      </Button>
                    </>
                  }
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Called / In service</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...board.called, ...board.inService].map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                actions={
                  entry.state === 'CALLED' ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api(`/clinic/queue/${entry.id}/start-turn`, { method: 'POST', json: {} }),
                          )
                        }
                      >
                        Start consultation
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api(`/clinic/queue/${entry.id}/recall`, { method: 'POST', json: {} }),
                          )
                        }
                      >
                        Recall
                      </Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => setSkipId(entry.id)}>
                        Skip
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(`/clinic/queue/${entry.id}/finish-turn`, { method: 'POST', json: {} }),
                        )
                      }
                    >
                      Complete consultation
                    </Button>
                  )
                }
              />
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="font-semibold">Booked (not checked in) / Held / Skipped</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {[...board.reserved, ...board.held, ...board.skipped].map((entry) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                actions={
                  <>
                    {entry.state === 'RESERVED' ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api(`/clinic/appointments/${entry.appointmentId}/check-in`, {
                              method: 'POST',
                              json: {},
                            }),
                          )
                        }
                      >
                        Check in
                      </Button>
                    ) : null}
                    {entry.state === 'HELD' || entry.state === 'SKIPPED' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api(`/clinic/queue/${entry.id}/restore`, { method: 'POST', json: {} }),
                          )
                        }
                      >
                        Restore
                      </Button>
                    ) : null}
                  </>
                }
              />
            ))}
            {board.completed.length ? (
              <p className="pt-2 text-xs text-muted-foreground">
                Completed: {board.completed.map((c) => `#${c.queueDisplay}`).join(', ')}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {skipId ? (
        <Card>
          <CardHeader>
            <h2 className="font-semibold">Skip patient</h2>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder="Reason"
              value={skipReason}
              onChange={(e) => setSkipReason(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                disabled={busy || skipReason.trim().length < 3}
                onClick={() => {
                  const target = skipId;
                  void run(() =>
                    api(`/clinic/queue/${target}/skip`, {
                      method: 'POST',
                      json: { reason: skipReason.trim() },
                    }),
                  ).then(() => {
                    setSkipId(null);
                    setSkipReason('');
                  });
                }}
              >
                Confirm skip
              </Button>
              <Button type="button" variant="outline" onClick={() => setSkipId(null)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
