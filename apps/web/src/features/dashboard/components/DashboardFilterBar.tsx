import { useMemo, useState } from 'react';
import { Calendar, Check, ChevronDown, RotateCcw, Search, User, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatSessionTime } from '@/features/sessions/utils/session-formatters';
import { cn } from '@/lib/utils';
import type { DashboardFilters, DashboardPreset } from '../types';

type DoctorOption = {
  id: string;
  displayName: string;
};

type SessionOption = {
  id: string;
  doctorDisplayName: string | null;
  localDate: string;
  startAt?: string;
  endAt?: string;
};

interface DashboardFilterBarProps {
  filters: DashboardFilters;
  onChange: (patch: Partial<DashboardFilters>) => void;
  onReset: () => void;
  doctors: DoctorOption[];
  sessions: SessionOption[];
  loading?: boolean;
}

/** Date · doctor · start–end, so sessions of the same doctor on the same day can be told apart. */
function sessionLabel(s: SessionOption): string {
  const time = s.startAt && s.endAt ? ` · ${formatSessionTime(s.startAt, s.endAt)}` : '';
  return `${s.localDate} · ${s.doctorDisplayName || 'Clinic'}${time}`;
}

/** Searchable session picker: matches doctor name, date or time (e.g. "Perera", "2026-11-23", "5:00 pm"). */
function SessionFilterCombobox({
  sessions,
  value,
  onChange,
}: {
  sessions: SessionOption[];
  value: string;
  onChange: (sessionId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const options = useMemo(
    () =>
      sessions.map((s) => {
        const label = sessionLabel(s);
        // Also match times typed without a leading zero ("5:00 pm" as well as "05:00 pm").
        const haystack = `${label} ${label.replace(/\b0(\d:)/g, '$1')}`.toLowerCase();
        return { id: s.id, label, haystack };
      }),
    [sessions],
  );

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = terms.length
    ? options.filter((o) => terms.every((t) => o.haystack.includes(t)))
    : options;
  const selected = value === 'all' ? null : options.find((o) => o.id === value);

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setQuery('');
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-xs text-foreground shadow-xs focus:outline-hidden focus:ring-1 focus:ring-ring"
        >
          <span className="truncate">{selected ? selected.label : 'All sessions'}</span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) min-w-72 p-0"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filtered[0]) {
                e.preventDefault();
                select(filtered[0].id);
              }
            }}
            placeholder="Search doctor, date or time…"
            className="h-9 w-full bg-transparent text-xs outline-hidden placeholder:text-muted-foreground"
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1" role="listbox">
          {!terms.length ? (
            <SessionOptionRow label="All sessions" active={value === 'all'} onSelect={() => select('all')} />
          ) : null}
          {filtered.map((o) => (
            <SessionOptionRow key={o.id} label={o.label} active={o.id === value} onSelect={() => select(o.id)} />
          ))}
          {terms.length && !filtered.length ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">No sessions match “{query.trim()}”</p>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SessionOptionRow({
  label,
  active,
  onSelect,
}: {
  label: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground',
        active && 'bg-accent/60 font-medium',
      )}
    >
      <Check className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
      <span className="truncate">{label}</span>
    </button>
  );
}

const PRESET_OPTIONS: { id: DashboardPreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This Week' },
  { id: 'month', label: 'This Month' },
  { id: 'custom', label: 'Custom' },
];

export function DashboardFilterBar({
  filters,
  onChange,
  onReset,
  doctors,
  sessions,
  loading = false,
}: DashboardFilterBarProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-xs">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Preset Buttons */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-medium text-muted-foreground">Range:</span>
          {PRESET_OPTIONS.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              size="sm"
              variant={filters.preset === opt.id ? 'default' : 'outline'}
              className={cn(
                'h-8 text-xs font-medium cursor-pointer',
                filters.preset === opt.id ? 'shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => onChange({ preset: opt.id })}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
            onClick={onReset}
            disabled={loading}
          >
            <RotateCcw className="mr-1.5 size-3.5" />
            Reset filters
          </Button>
        </div>
      </div>

      {/* Secondary filter controls (Date pickers, Doctor, Session) */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {/* From / To dates are only shown for the Custom range */}
        {filters.preset === 'custom' ? (
          <>
            <div>
              <Label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="size-3.5" />
                From Date
              </Label>
              <Input
                type="date"
                className="h-9 text-xs"
                value={filters.from}
                onChange={(e) => onChange({ from: e.target.value, preset: 'custom' })}
              />
            </div>

            <div>
              <Label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Calendar className="size-3.5" />
                To Date
              </Label>
              <Input
                type="date"
                className="h-9 text-xs"
                value={filters.to}
                onChange={(e) => onChange({ to: e.target.value, preset: 'custom' })}
              />
            </div>
          </>
        ) : null}

        {/* Doctor Filter */}
        <div>
          <Label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="size-3.5" />
            Doctor
          </Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground shadow-xs focus:outline-hidden focus:ring-1 focus:ring-ring"
            value={filters.doctorId}
            onChange={(e) => onChange({ doctorId: e.target.value, sessionId: 'all' })}
          >
            <option value="all">All doctors</option>
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.displayName}
              </option>
            ))}
          </select>
        </div>

        {/* Session Filter */}
        <div>
          <Label className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            Consultation Session
          </Label>
          <SessionFilterCombobox
            sessions={sessions}
            value={filters.sessionId}
            onChange={(sessionId) => onChange({ sessionId })}
          />
        </div>
      </div>
    </div>
  );
}
