import { CalendarClock, CalendarDays, PlayCircle, Users, XCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export type SessionsSummary = {
  todayCount: number;
  upcomingCount: number;
  scheduledCapacity: number;
  cancelledCount: number;
  /** Sessions currently in progress (open or paused). */
  openCount: number;
  rangeLabel: string;
};

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof CalendarDays;
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <Card className="shadow-none">
      <CardContent className="flex items-start gap-3 py-4">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {label}
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

/** Highlighted, clickable card for sessions that are open right now. */
function OpenSessionsCard({
  count,
  active,
  onClick,
}: {
  count: number;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      className={cn(
        'shadow-none cursor-pointer border-emerald-500/40 bg-emerald-500/5 transition-shadow hover:shadow-md focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
        active && 'border-emerald-600 ring-2 ring-emerald-500/40',
      )}
    >
      <CardContent className="flex items-start gap-3 py-4">
        <div className="relative flex size-9 shrink-0 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
          <PlayCircle className="size-4" />
          {count > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-pulse rounded-full bg-emerald-500" />
          ) : null}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide text-emerald-800 uppercase dark:text-emerald-300">
            Open sessions
          </p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{count}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {active ? 'Showing open sessions' : 'Click to view and manage queues'}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function SessionsSummaryCards({
  summary,
  loading,
  openActive,
  onOpenSessionsClick,
}: {
  summary: SessionsSummary | null;
  loading?: boolean;
  /** True while the list is filtered to open sessions. */
  openActive?: boolean;
  onOpenSessionsClick?: () => void;
}) {
  if (loading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Card key={i} className="shadow-none">
            <CardContent className="space-y-3 py-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
              <Skeleton className="h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      <OpenSessionsCard
        count={summary.openCount}
        active={openActive}
        onClick={onOpenSessionsClick}
      />
      <SummaryCard
        icon={CalendarDays}
        label="Today's sessions"
        value={summary.todayCount}
        hint="Clinic-local date (Asia/Colombo)"
      />
      <SummaryCard
        icon={CalendarClock}
        label="Upcoming"
        value={summary.upcomingCount}
        hint={summary.rangeLabel}
      />
      <SummaryCard
        icon={Users}
        label="Scheduled capacity"
        value={summary.scheduledCapacity}
        hint="Patient slots in upcoming window"
      />
      <SummaryCard
        icon={XCircle}
        label="Cancelled"
        value={summary.cancelledCount}
        hint={summary.rangeLabel}
      />
    </div>
  );
}
