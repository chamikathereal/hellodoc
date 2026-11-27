import { Link } from 'react-router-dom';
import { ListOrdered } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatSessionDate, formatSessionTime } from '../utils/session-formatters';
import type { SessionRow } from './SessionsDataTable';
import { SessionStatusBadge } from './SessionStatusBadge';

/** Open (in-progress) sessions, each with a direct link to its queue management board. */
export function OpenSessionsPanel({
  sessions,
  onSelectSession,
}: {
  sessions: SessionRow[];
  onSelectSession?: (sessionId: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-foreground">Open sessions ({sessions.length})</p>
        <p className="text-xs text-muted-foreground">
          Sessions in progress. Open a session&apos;s queue to check in patients, call the next patient,
          and start or complete consultations.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sessions.map((session) => (
          <div
            key={session.id}
            className="flex flex-col gap-3 rounded-lg border border-emerald-500/40 bg-card p-4 text-card-foreground"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground" title={session.doctorDisplayName ?? undefined}>
                  {session.doctorDisplayName}
                </p>
                {session.specialization ? (
                  <p className="truncate text-xs text-muted-foreground">{session.specialization}</p>
                ) : null}
              </div>
              <SessionStatusBadge status={session.status} />
            </div>
            <div className="text-sm">
              <p>{formatSessionDate(session.localDate)}</p>
              <p className="text-muted-foreground">
                {formatSessionTime(session.startAt, session.endAt, session.timezone)} · {session.capacity} patients
              </p>
            </div>
            <div className="mt-auto flex flex-wrap gap-2">
              <Button asChild type="button" size="sm">
                <Link to={`/sessions/${session.id}/queue`}>
                  <ListOrdered className="size-4" />
                  Manage queue
                </Link>
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onSelectSession?.(session.id)}
              >
                Details
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
