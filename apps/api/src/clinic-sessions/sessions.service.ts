import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import type { ClinicContext } from '../clinic-context/clinic-context.service.js';
import { NotificationsService } from '../clinic-notifications/notifications.service.js';
import { SmsDispatcherService } from '../clinic-notifications/sms-dispatcher.service.js';
import { QueueService } from '../clinic-queue/queue.service.js';
import { TenantSqlClient } from '../tenant-provisioning/tenant-sql.client.js';
import {
  CancelSessionDto,
  CreateSessionDto,
  ListSessionsQueryDto,
  UpdateSessionDto,
} from './dto/session.dto.js';

const DEFAULT_TZ = 'Asia/Colombo';
const MIN_SESSION_MINUTES = 15;

type SessionRow = {
  id: string;
  doctor_id: string;
  doctor_display_name?: string;
  /** pg DATE may arrive as Date or ISO/date string depending on driver. */
  local_date: string | Date;
  start_at: Date;
  end_at: Date;
  timezone: string;
  capacity: number;
  expected_duration_minutes: number;
  status: string;
  location: string | null;
  internal_notes: string | null;
  schedule_template_id: string | null;
  occurrence_key: string | null;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string | null;
};

/** Serialize a pg DATE to YYYY-MM-DD without UTC day-shift. */
function toDateOnlyIso(value: string | Date): string {
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value);
  // Prefer leading ISO date if present (e.g. "2026-11-18" or "2026-11-18T00:00:00.000Z")
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  return s.slice(0, 10);
}

function mapSession(row: SessionRow) {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    doctorDisplayName: row.doctor_display_name ?? null,
    localDate: toDateOnlyIso(row.local_date),
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    timezone: row.timezone,
    capacity: row.capacity,
    expectedDurationMinutes: row.expected_duration_minutes,
    status: row.status,
    location: row.location,
    internalNotes: row.internal_notes,
    scheduleTemplateId: row.schedule_template_id,
    occurrenceKey: row.occurrence_key,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancelledBy: row.cancelled_by,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

@Injectable()
export class SessionsService {
  constructor(
    private readonly sql: TenantSqlClient,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly smsDispatcher: SmsDispatcherService,
  ) {}

  async list(ctx: ClinicContext, query: ListSessionsQueryDto) {
    const limit = query.limit ?? 100;
    const offset = query.offset ?? 0;
    const params: unknown[] = [];
    const where: string[] = [];

    if (query.doctorId) {
      params.push(query.doctorId);
      where.push(`s.doctor_id = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      where.push(`s.local_date >= $${params.length}::date`);
    }
    if (query.to) {
      params.push(query.to);
      where.push(`s.local_date <= $${params.length}::date`);
    }
    if (query.status && query.status !== 'ALL') {
      params.push(query.status.split(','));
      where.push(`s.status = ANY($${params.length}::text[])`);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);

    return this.sql.withClient(async (client) => {
      const result = await client.query<SessionRow>(
        `SELECT s.*, d.display_name AS doctor_display_name
         FROM ${ctx.quotedSchema}.consultation_sessions s
         JOIN ${ctx.quotedSchema}.doctors d ON d.id = s.doctor_id
         ${whereSql}
         ORDER BY s.start_at ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return {
        items: result.rows.map(mapSession),
        limit,
        offset,
      };
    });
  }

  async get(ctx: ClinicContext, id: string) {
    return this.sql.withClient(async (client) => {
      const result = await client.query<SessionRow & { opened_at: Date | null; closed_at: Date | null }>(
        `SELECT s.*, d.display_name AS doctor_display_name,
                -- Actual open/close times come from the queue event log (first open, last close).
                (SELECT MIN(e.created_at) FROM ${ctx.quotedSchema}.queue_events e
                 WHERE e.session_id = s.id AND e.event_type = 'SESSION_OPEN') AS opened_at,
                (SELECT MAX(e.created_at) FROM ${ctx.quotedSchema}.queue_events e
                 WHERE e.session_id = s.id AND e.event_type = 'SESSION_CLOSED') AS closed_at
         FROM ${ctx.quotedSchema}.consultation_sessions s
         JOIN ${ctx.quotedSchema}.doctors d ON d.id = s.doctor_id
         WHERE s.id = $1`,
        [id],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('Session not found');
      return {
        ...mapSession(row),
        openedAt: row.opened_at?.toISOString() ?? null,
        closedAt: row.closed_at?.toISOString() ?? null,
      };
    });
  }

  async create(ctx: ClinicContext, dto: CreateSessionDto) {
    const timezone = dto.timezone?.trim() || DEFAULT_TZ;
    const capacity = dto.capacity ?? 20;
    const expectedDurationMinutes = dto.expectedDurationMinutes ?? 10;
    this.assertTimeOrder(dto.startTime, dto.endTime);

    return this.sql.withClient(async (client) => {
      const doctor = await client.query<{ id: string; status: string; display_name: string }>(
        `SELECT id, status, display_name FROM ${ctx.quotedSchema}.doctors WHERE id = $1`,
        [dto.doctorId],
      );
      if (!doctor.rows[0]) throw new NotFoundException('Doctor not found');
      if (doctor.rows[0].status !== 'ACTIVE') {
        throw new BadRequestException('Inactive doctors cannot receive new sessions');
      }

      const bounds = await this.resolveBounds(client, dto.localDate, dto.startTime, dto.endTime, timezone);
      this.assertNotEnded(bounds.startAt, bounds.endAt);
      this.assertMinLength(bounds.startAt, bounds.endAt);
      this.assertCapacityFits(bounds.startAt, bounds.endAt, capacity, expectedDurationMinutes);

      const id = randomUUID();
      try {
        const inserted = await client.query<SessionRow>(
          `INSERT INTO ${ctx.quotedSchema}.consultation_sessions
            (id, doctor_id, local_date, start_at, end_at, timezone, capacity,
             expected_duration_minutes, status, location, internal_notes, created_by, updated_by)
           VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,'SCHEDULED',$9,$10,$11,$11)
           RETURNING *`,
          [
            id,
            dto.doctorId,
            dto.localDate,
            bounds.startAt,
            bounds.endAt,
            timezone,
            capacity,
            expectedDurationMinutes,
            dto.location?.trim() || null,
            dto.internalNotes?.trim() || null,
            ctx.userId,
          ],
        );
        await this.audit.record({
          actorId: ctx.userId,
          action: 'session.created',
          targetType: 'consultation_session',
          targetId: id,
          metadata: { tenantId: ctx.tenantId, doctorId: dto.doctorId },
        });
        return mapSession({
          ...inserted.rows[0]!,
          doctor_display_name: doctor.rows[0].display_name,
        });
      } catch (error) {
        this.rethrowOverlap(error);
      }
    });
  }

  async update(ctx: ClinicContext, id: string, dto: UpdateSessionDto) {
    this.assertTimeOrder(dto.startTime, dto.endTime);
    return this.sql.withClient(async (client) => {
      const existing = await client.query<SessionRow>(
        `SELECT * FROM ${ctx.quotedSchema}.consultation_sessions WHERE id = $1`,
        [id],
      );
      if (!existing.rows[0]) throw new NotFoundException('Session not found');
      if (existing.rows[0].status !== 'SCHEDULED') {
        throw new BadRequestException('Only SCHEDULED sessions can be edited');
      }
      if (existing.rows[0].start_at.getTime() <= Date.now()) {
        throw new BadRequestException('Past sessions cannot be edited');
      }

      const bounds = await this.resolveBounds(
        client,
        dto.localDate,
        dto.startTime,
        dto.endTime,
        existing.rows[0].timezone || DEFAULT_TZ,
      );
      this.assertNotEnded(bounds.startAt, bounds.endAt);
      this.assertMinLength(bounds.startAt, bounds.endAt);

      try {
        const updated = await client.query<SessionRow>(
          `UPDATE ${ctx.quotedSchema}.consultation_sessions SET
             local_date = $2::date,
             start_at = $3,
             end_at = $4,
             capacity = $5,
             expected_duration_minutes = $6,
             location = $7,
             internal_notes = $8,
             updated_by = $9,
             updated_at = NOW(),
             version = version + 1
           WHERE id = $1 AND version = $10 AND status = 'SCHEDULED'
           RETURNING *`,
          [
            id,
            dto.localDate,
            bounds.startAt,
            bounds.endAt,
            dto.capacity,
            dto.expectedDurationMinutes,
            dto.location?.trim() || null,
            dto.internalNotes?.trim() || null,
            ctx.userId,
            dto.version,
          ],
        );
        if (!updated.rows[0]) {
          throw new ConflictException('Session was modified by another user. Refresh and try again.');
        }
        await this.audit.record({
          actorId: ctx.userId,
          action: 'session.updated',
          targetType: 'consultation_session',
          targetId: id,
          metadata: { tenantId: ctx.tenantId },
        });
        return mapSession(updated.rows[0]);
      } catch (error) {
        if (error instanceof ConflictException) throw error;
        this.rethrowOverlap(error);
      }
    });
  }

  async cancel(ctx: ClinicContext, id: string, dto: CancelSessionDto) {
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const locked = await client.query<SessionRow>(
          `SELECT * FROM ${ctx.quotedSchema}.consultation_sessions
           WHERE id = $1
           FOR UPDATE`,
          [id],
        );
        const row = locked.rows[0];
        if (!row || row.status !== 'SCHEDULED' || row.start_at.getTime() <= Date.now()) {
          throw new BadRequestException('Only future SCHEDULED sessions can be cancelled');
        }

        const updated = await client.query<SessionRow>(
          `UPDATE ${ctx.quotedSchema}.consultation_sessions SET
             status = 'CANCELLED',
             cancellation_reason = $2,
             cancelled_at = NOW(),
             cancelled_by = $3,
             updated_by = $3,
             updated_at = NOW(),
             version = version + 1
           WHERE id = $1 AND status = 'SCHEDULED' AND start_at > NOW()
           RETURNING *`,
          [id, dto.reason.trim(), ctx.userId],
        );
        if (!updated.rows[0]) {
          throw new BadRequestException('Only future SCHEDULED sessions can be cancelled');
        }

        // Bookings in a cancelled session are cancelled too, and each patient gets the cancellation SMS.
        const cancelledAppointments = await client.query<{ id: string }>(
          `UPDATE ${ctx.quotedSchema}.appointments SET
             status = 'CANCELLED',
             cancellation_reason = $2,
             cancelled_at = NOW(),
             cancelled_by = $3,
             updated_at = NOW(),
             updated_by = $3,
             version = version + 1
           WHERE session_id = $1 AND status = 'CONFIRMED'
           RETURNING id`,
          [id, `Session cancelled: ${dto.reason.trim()}`, ctx.userId],
        );
        for (const appointment of cancelledAppointments.rows) {
          await this.queue.invalidateForAppointment(client, ctx.quotedSchema, appointment.id);
          await this.notifications.enqueueForAppointment(client, ctx, {
            appointmentId: appointment.id,
            eventType: 'CANCELLATION',
            dedupeKey: `CANCELLATION:${appointment.id}`,
            includeTrackingLink: false,
            suppressPendingApproaching: true,
          });
        }

        await client.query('COMMIT');
        if (cancelledAppointments.rows.length > 0) this.smsDispatcher.kick();
        await this.audit.record({
          actorId: ctx.userId,
          action: 'session.cancelled',
          targetType: 'consultation_session',
          targetId: id,
          metadata: { tenantId: ctx.tenantId, cancelledAppointments: cancelledAppointments.rows.length },
        });
        return { ...mapSession(updated.rows[0]), cancelledAppointments: cancelledAppointments.rows.length };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  private assertTimeOrder(startTime: string, endTime: string) {
    if (endTime <= startTime) {
      throw new BadRequestException('End time must be after start time (midnight-crossing sessions are not supported)');
    }
  }

  private assertNotEnded(startAt: Date, endAt: Date) {
    const now = Date.now();
    if (endAt.getTime() <= now) {
      throw new BadRequestException(
        'This session time has already ended. Choose a later end time or date (Asia/Colombo).',
      );
    }
    if (startAt.getTime() > endAt.getTime()) {
      throw new BadRequestException('Session start must be before the end time');
    }
  }

  /** Same rule as weekly schedules: every patient's expected consult must fit within the session time. */
  private assertCapacityFits(startAt: Date, endAt: Date, capacity: number, durationMinutes: number) {
    const sessionMinutes = Math.round((endAt.getTime() - startAt.getTime()) / 60000);
    if (durationMinutes > sessionMinutes) {
      throw new BadRequestException(
        `Expected consult (${durationMinutes} min) cannot be longer than the session (${sessionMinutes} min)`,
      );
    }
    if (capacity * durationMinutes > sessionMinutes) {
      const maxCapacity = Math.floor(sessionMinutes / durationMinutes);
      throw new BadRequestException(
        `${capacity} patients × ${durationMinutes} min = ${capacity * durationMinutes} min, but the session is only ` +
          `${sessionMinutes} min. Reduce maximum patients to ${maxCapacity} or less, shorten the consult time, or extend the session.`,
      );
    }
  }

    private assertMinLength(startAt: Date, endAt: Date) {
    const minutes = (endAt.getTime() - startAt.getTime()) / 60000;
    if (minutes < MIN_SESSION_MINUTES) {
      throw new BadRequestException(`Session must be at least ${MIN_SESSION_MINUTES} minutes`);
    }
  }

  private async resolveBounds(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ start_at: Date; end_at: Date }> }> },
    localDate: string,
    startTime: string,
    endTime: string,
    timezone: string,
  ) {
    const result = await client.query(
      `SELECT
         (($1::date + $2::time) AT TIME ZONE $4) AS start_at,
         (($1::date + $3::time) AT TIME ZONE $4) AS end_at`,
      [localDate, startTime, endTime, timezone],
    );
    const row = result.rows[0];
    if (!row) throw new BadRequestException('Invalid session date/time');
    return { startAt: row.start_at, endAt: row.end_at };
  }

  private rethrowOverlap(error: unknown): never {
    if ((error as { code?: string }).code === '23P01') {
      throw new ConflictException('This doctor already has an overlapping consultation session');
    }
    throw error;
  }
}
