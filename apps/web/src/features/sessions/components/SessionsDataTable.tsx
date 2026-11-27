import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ConsultationSession } from '@/lib/clinic-types';
import {
  formatSessionDate,
  formatSessionDuration,
  formatSessionTime,
} from '../utils/session-formatters';
import { canModifySession } from '../utils/session-status';
import { SessionCancelDialog } from './SessionCancelDialog';
import { SessionStatusBadge } from './SessionStatusBadge';

export type SessionRow = ConsultationSession & {
  specialization?: string | null;
};

function SortIcon({ sorted }: { sorted: false | 'asc' | 'desc' }) {
  if (sorted === 'asc') return <ArrowUp className="size-3.5" />;
  if (sorted === 'desc') return <ArrowDown className="size-3.5" />;
  return <ArrowUpDown className="size-3.5 opacity-50" />;
}

export function SessionsDataTable({
  data,
  pageSize,
  pageIndex,
  onPageChange,
  onPageSizeChange,
  onCancel,
  onCreate,
  onSelectSession,
}: {
  data: SessionRow[];
  pageSize: number;
  pageIndex: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onCancel: (sessionId: string, reason: string) => Promise<void>;
  onCreate?: () => void;
  onSelectSession?: (sessionId: string, edit?: boolean) => void;
}) {
  const navigate = useNavigate();
  const [sorting, setSorting] = useState<SortingState>([{ id: 'startAt', desc: false }]);
  const [cancelTarget, setCancelTarget] = useState<SessionRow | null>(null);

  const columns = useMemo<ColumnDef<SessionRow>[]>(
    () => [
      {
        accessorKey: 'doctorDisplayName',
        id: 'doctor',
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Doctor
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => (
          <div className="min-w-[10rem]">
            <p className="font-medium text-foreground">{row.original.doctorDisplayName}</p>
            {row.original.specialization ? (
              <p className="text-xs text-muted-foreground">{row.original.specialization}</p>
            ) : null}
          </div>
        ),
      },
      {
        accessorKey: 'localDate',
        id: 'date',
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Date
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => (
          <span>{formatSessionDate(row.original.localDate, row.original.timezone)}</span>
        ),
      },
      {
        accessorKey: 'startAt',
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Time
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => (
          <div>
            <p>
              {formatSessionTime(
                row.original.startAt,
                row.original.endAt,
                row.original.timezone,
              )}
            </p>
            <p className="text-[11px] text-muted-foreground">{row.original.timezone}</p>
          </div>
        ),
      },
      {
        id: 'duration',
        accessorFn: (row) =>
          new Date(row.endAt).getTime() - new Date(row.startAt).getTime(),
        header: 'Duration',
        cell: ({ row }) => formatSessionDuration(row.original.startAt, row.original.endAt),
      },
      {
        accessorKey: 'capacity',
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Capacity
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="tabular-nums">{row.original.capacity} patients</span>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3 h-8"
            onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          >
            Status
            <SortIcon sorted={column.getIsSorted()} />
          </Button>
        ),
        cell: ({ row }) => <SessionStatusBadge status={row.original.status} />,
      },
      {
        id: 'actions',
        header: 'Actions',
        enableSorting: false,
        cell: ({ row }) => {
          const session = row.original;
          const canModify = canModifySession(session.status, session.startAt);
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Actions for ${session.doctorDisplayName}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem
                  onClick={() =>
                    onSelectSession
                      ? onSelectSession(session.id, false)
                      : navigate(`/sessions?detail=${session.id}`)
                  }
                >
                  View details
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate(`/sessions/${session.id}/queue`)}>
                  Manage queue
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canModify}
                  onClick={() =>
                    onSelectSession
                      ? onSelectSession(session.id, true)
                      : navigate(`/sessions?detail=${session.id}&edit=1`)
                  }
                >
                  Edit session
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!canModify}
                  className="text-destructive focus:text-destructive"
                  onClick={() => setCancelTarget(session)}
                >
                  Cancel session
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [navigate],
  );

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      pagination: { pageIndex, pageSize },
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: false,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? updater({ pageIndex, pageSize })
          : updater;
      if (next.pageIndex !== pageIndex) onPageChange(next.pageIndex + 1);
      if (next.pageSize !== pageSize) onPageSizeChange(next.pageSize);
    },
  });

  const pageCount = table.getPageCount();
  const showingFrom = data.length === 0 ? 0 : pageIndex * pageSize + 1;
  const showingTo = Math.min((pageIndex + 1) * pageSize, data.length);

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-lg border border-border/80 bg-card shadow-2xs">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((header) => (
                  <TableHead key={header.id}>
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className="cursor-pointer hover:bg-muted/35"
                onClick={() => {
                  if (onSelectSession) onSelectSession(row.original.id, false);
                  else navigate(`/sessions?detail=${row.original.id}`);
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id} className="whitespace-normal">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="flex flex-col gap-3 border-t border-border/70 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between text-xs text-muted-foreground">
          <p>
            Showing {showingFrom}–{showingTo} of {data.length}
            {data.length > 0 ? (
              <>
                {' · '}
                <button
                  type="button"
                  className="font-medium text-primary hover:underline"
                  onClick={onCreate}
                >
                  Create session
                </button>
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">Rows per page:</span>
            <Select
              value={String(pageSize)}
              onValueChange={(v) => onPageSizeChange(Number(v))}
            >
              <SelectTrigger className="h-8 w-24 bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[10, 20, 30, 50].map((n) => (
                  <SelectItem key={n} value={String(n)} className="text-xs">
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              disabled={pageIndex <= 0}
              onClick={() => onPageChange(pageIndex)}
            >
              Previous
            </Button>
            <span className="text-xs tabular-nums text-foreground font-medium px-1">
              Page {pageIndex + 1} of {Math.max(pageCount, 1)}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 px-2.5 text-xs"
              disabled={pageIndex + 1 >= pageCount}
              onClick={() => onPageChange(pageIndex + 2)}
            >
              Next
            </Button>
          </div>
        </div>
      </div>

      <SessionCancelDialog
        open={Boolean(cancelTarget)}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        doctorName={cancelTarget?.doctorDisplayName ?? 'this doctor'}
        onConfirm={async (reason) => {
          if (!cancelTarget) return;
          await onCancel(cancelTarget.id, reason);
          setCancelTarget(null);
        }}
      />
    </div>
  );
}
