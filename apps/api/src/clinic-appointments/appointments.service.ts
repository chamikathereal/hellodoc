import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import type { ClinicContext } from '../clinic-context/clinic-context.service.js';
import { NotificationsService } from '../clinic-notifications/notifications.service.js';
import { SmsDispatcherService } from '../clinic-notifications/sms-dispatcher.service.js';
import { QueueService } from '../clinic-queue/queue.service.js';
import { TenantSqlClient } from '../tenant-provisioning/tenant-sql.client.js';
import {
  assertTransition,
  formatBookingReference,
  formatQueueDisplay,
  isSessionBookable,
  type AppointmentStatus,
} from './appointment-rules.js';
import {
  CancelAppointmentDto,
  CreateAppointmentDto,
  ListAppointmentsQueryDto,
  RescheduleAppointmentDto,
} from './dto/appointment.dto.js';

type SessionLockRow = {
  id: string;
  doctor_id: string;
  doctor_display_name: string | null;
  doctor_status: string;
  local_date: Date | string;
  start_at: Date;
  end_at: Date;
  timezone: string;
  capacity: number;
  status: string;
  next_queue_number: number;
  version: number;
};

type AppointmentRow = {
  id: string;
  booking_reference: string;
  patient_id: string;
  session_id: string;
  queue_number: number;
  booking_source: string;
  status: AppointmentStatus;
  internal_notes: string | null;
  cancellation_reason: string | null;
  cancelled_at: Date | null;
  cancelled_by: string | null;
  rescheduled_from_id: string | null;
  reschedule_reason: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string | null;
  patient_number?: string;
  patient_full_name?: string;
  doctor_id?: string;
  doctor_display_name?: string | null;
  local_date?: Date | string;
  start_at?: Date;
  end_at?: Date;
  timezone?: string;
  session_status?: string;
  queue_state?: string | null;
  queue_checked_in_at?: Date | null;
  queue_called_at?: Date | null;
  queue_service_started_at?: Date | null;
  queue_finished_at?: Date | null;
};

function toDateOnlyIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, '0');
    const d = String(value.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const m = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : String(value).slice(0, 10);
}

function payloadHash(dto: CreateAppointmentDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        patientId: dto.patientId,
        sessionId: dto.sessionId,
        bookingSource: dto.bookingSource,
        internalNotes: dto.internalNotes?.trim() ?? null,
      }),
    )
    .digest('hex');
}

function httpError(code: string, message: string, status: 'bad' | 'conflict' | 'notfound' = 'bad') {
  const body = { message, code };
  if (status === 'conflict') throw new ConflictException(body);
  if (status === 'notfound') throw new NotFoundException(body);
  throw new BadRequestException(body);
}

function mapAppointment(row: AppointmentRow) {
  return {
    id: row.id,
    bookingReference: row.booking_reference,
    patientId: row.patient_id,
    patientNumber: row.patient_number ?? null,
    patientFullName: row.patient_full_name ?? null,
    sessionId: row.session_id,
    doctorId: row.doctor_id ?? null,
    doctorDisplayName: row.doctor_display_name ?? null,
    localDate: toDateOnlyIso(row.local_date),
    startAt: row.start_at?.toISOString() ?? null,
    endAt: row.end_at?.toISOString() ?? null,
    timezone: row.timezone ?? null,
    sessionStatus: row.session_status ?? null,
    queueState: row.queue_state ?? null,
    checkedInAt: row.queue_checked_in_at?.toISOString() ?? null,
    calledAt: row.queue_called_at?.toISOString() ?? null,
    consultationStartedAt: row.queue_service_started_at?.toISOString() ?? null,
    consultationEndedAt: row.queue_finished_at?.toISOString() ?? null,
    queueNumber: row.queue_number,
    queueDisplay: formatQueueDisplay(row.queue_number),
    bookingSource: row.booking_source,
    status: row.status,
    internalNotes: row.internal_notes,
    cancellationReason: row.cancellation_reason,
    cancelledAt: row.cancelled_at?.toISOString() ?? null,
    cancelledBy: row.cancelled_by,
    rescheduledFromId: row.rescheduled_from_id,
    rescheduleReason: row.reschedule_reason,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

const APPOINTMENT_SELECT = `
  SELECT a.*,
         p.patient_number,
         p.full_name AS patient_full_name,
         s.doctor_id,
         d.display_name AS doctor_display_name,
         s.local_date,
         s.start_at,
         s.end_at,
         s.timezone,
         s.status AS session_status,
         q.state AS queue_state,
         q.checked_in_at AS queue_checked_in_at,
         q.called_at AS queue_called_at,
         q.service_started_at AS queue_service_started_at,
         q.finished_at AS queue_finished_at
  FROM __SCHEMA__.appointments a
  JOIN __SCHEMA__.patients p ON p.id = a.patient_id
  JOIN __SCHEMA__.consultation_sessions s ON s.id = a.session_id
  JOIN __SCHEMA__.doctors d ON d.id = s.doctor_id
  LEFT JOIN __SCHEMA__.queue_entries q ON q.appointment_id = a.id
`;

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly sql: TenantSqlClient,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
    private readonly smsDispatcher: SmsDispatcherService,
  ) {}

  /** Once a patient has checked in, the appointment follows the consultation workflow instead. */
  private async assertNotCheckedIn(
    client: PoolClient,
    quotedSchema: string,
    appointmentId: string,
    action: 'cancelled' | 'rescheduled',
  ) {
    const entry = await client.query<{ checked_in_at: Date | null }>(
      `SELECT checked_in_at FROM ${quotedSchema}.queue_entries WHERE appointment_id = $1`,
      [appointmentId],
    );
    if (entry.rows[0]?.checked_in_at) {
      httpError(
        'APPOINTMENT_CHECKED_IN',
        `This patient has already checked in, so the appointment can no longer be ${action}.`,
        'conflict',
      );
    }
  }

  private selectSql(quotedSchema: string) {
    return APPOINTMENT_SELECT.replaceAll('__SCHEMA__', quotedSchema);
  }

  private async loadAppointment(client: PoolClient, quotedSchema: string, id: string) {
    const result = await client.query<AppointmentRow>(
      `${this.selectSql(quotedSchema)} WHERE a.id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  private async lockSession(client: PoolClient, quotedSchema: string, sessionId: string) {
    const result = await client.query<SessionLockRow>(
      `SELECT s.id, s.doctor_id, d.display_name AS doctor_display_name, d.status AS doctor_status,
              s.local_date, s.start_at, s.end_at, s.timezone, s.capacity, s.status,
              s.next_queue_number, s.version
       FROM ${quotedSchema}.consultation_sessions s
       JOIN ${quotedSchema}.doctors d ON d.id = s.doctor_id
       WHERE s.id = $1
       FOR UPDATE OF s`,
      [sessionId],
    );
    return result.rows[0] ?? null;
  }

  private async activeCount(client: PoolClient, quotedSchema: string, sessionId: string) {
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM ${quotedSchema}.appointments
       WHERE session_id = $1 AND status = 'CONFIRMED'`,
      [sessionId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private assertBookableSession(session: SessionLockRow) {
    if (!isSessionBookable({ status: session.status, endAt: session.end_at })) {
      httpError('SESSION_NOT_BOOKABLE', 'Session is not bookable', 'conflict');
    }
    if (session.doctor_status !== 'ACTIVE') {
      httpError('SESSION_NOT_BOOKABLE', 'Doctor is not eligible for new bookings', 'conflict');
    }
  }

  async availability(ctx: ClinicContext, sessionId: string) {
    return this.sql.withClient(async (client) => {
      const session = await client.query<SessionLockRow>(
        `SELECT s.id, s.doctor_id, d.display_name AS doctor_display_name, d.status AS doctor_status,
                s.local_date, s.start_at, s.end_at, s.timezone, s.capacity, s.status,
                s.next_queue_number, s.version
         FROM ${ctx.quotedSchema}.consultation_sessions s
         JOIN ${ctx.quotedSchema}.doctors d ON d.id = s.doctor_id
         WHERE s.id = $1`,
        [sessionId],
      );
      const row = session.rows[0];
      if (!row) httpError('SESSION_NOT_FOUND', 'Session not found', 'notfound');
      const booked = await this.activeCount(client, ctx.quotedSchema, sessionId);
      const bookable = isSessionBookable({ status: row.status, endAt: row.end_at }) &&
        row.doctor_status === 'ACTIVE';
      return {
        sessionId: row.id,
        doctorId: row.doctor_id,
        doctorDisplayName: row.doctor_display_name,
        localDate: toDateOnlyIso(row.local_date),
        startAt: row.start_at.toISOString(),
        endAt: row.end_at.toISOString(),
        timezone: row.timezone,
        capacity: row.capacity,
        bookedCount: booked,
        remaining: Math.max(0, row.capacity - booked),
        nextQueueNumber: row.next_queue_number,
        status: row.status,
        bookable: bookable && booked < row.capacity,
      };
    });
  }

  async list(ctx: ClinicContext, query: ListAppointmentsQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const status = query.status ?? 'CONFIRMED';
    const params: unknown[] = [];
    const where: string[] = [];

    if (status !== 'ALL') {
      params.push(status);
      where.push(`a.status = $${params.length}`);
    }
    if (query.doctorId) {
      params.push(query.doctorId);
      where.push(`s.doctor_id = $${params.length}`);
    }
    if (query.sessionId) {
      params.push(query.sessionId);
      where.push(`a.session_id = $${params.length}`);
    }
    if (query.patientId) {
      params.push(query.patientId);
      where.push(`a.patient_id = $${params.length}`);
    }
    if (query.bookingSource) {
      params.push(query.bookingSource);
      where.push(`a.booking_source = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      where.push(`s.local_date >= $${params.length}::date`);
    }
    if (query.to) {
      params.push(query.to);
      where.push(`s.local_date <= $${params.length}::date`);
    }
    if (query.q?.trim()) {
      params.push(`%${query.q.trim().toLowerCase()}%`);
      where.push(
        `(lower(p.full_name) LIKE $${params.length} OR lower(p.patient_number) LIKE $${params.length} OR lower(a.booking_reference) LIKE $${params.length})`,
      );
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    params.push(limit, offset);

    return this.sql.withClient(async (client) => {
      const result = await client.query<AppointmentRow>(
        `${this.selectSql(ctx.quotedSchema)}
         ${whereSql}
         ORDER BY s.local_date DESC, a.queue_number ASC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count
         FROM ${ctx.quotedSchema}.appointments a
         JOIN ${ctx.quotedSchema}.patients p ON p.id = a.patient_id
         JOIN ${ctx.quotedSchema}.consultation_sessions s ON s.id = a.session_id
         ${whereSql}`,
        params.slice(0, params.length - 2),
      );
      return {
        items: result.rows.map(mapAppointment),
        total: Number(count.rows[0]?.count ?? 0),
        limit,
        offset,
      };
    });
  }

  async listForSession(ctx: ClinicContext, sessionId: string) {
    return this.list(ctx, { sessionId, status: 'ALL', limit: 100, offset: 0 });
  }

  async get(ctx: ClinicContext, id: string) {
    return this.sql.withClient(async (client) => {
      const row = await this.loadAppointment(client, ctx.quotedSchema, id);
      if (!row) httpError('APPOINTMENT_NOT_FOUND', 'Appointment not found', 'notfound');
      // A rescheduled appointment points staff to the booking that replaced it (the latest in the
      // reschedule chain), so further reschedule/cancel actions can be taken from it.
      let rescheduledToId: string | null = null;
      if (row.status === 'RESCHEDULED') {
        const latest = await client.query<{ id: string }>(
          `WITH RECURSIVE chain AS (
             SELECT id, 1 AS depth FROM ${ctx.quotedSchema}.appointments WHERE rescheduled_from_id = $1
             UNION ALL
             SELECT a.id, c.depth + 1 FROM ${ctx.quotedSchema}.appointments a
             JOIN chain c ON a.rescheduled_from_id = c.id
             WHERE c.depth < 50
           )
           SELECT id FROM chain ORDER BY depth DESC LIMIT 1`,
          [id],
        );
        rescheduledToId = latest.rows[0]?.id ?? null;
      }
      return { ...mapAppointment(row), rescheduledToId };
    });
  }

  private async insertBooking(
    client: PoolClient,
    ctx: ClinicContext,
    input: {
      patientId: string;
      session: SessionLockRow;
      bookingSource: string;
      internalNotes: string | null;
      rescheduledFromId?: string | null;
      rescheduleReason?: string | null;
    },
  ) {
    const patient = await client.query<{ id: string; status: string }>(
      `SELECT id, status FROM ${ctx.quotedSchema}.patients WHERE id = $1`,
      [input.patientId],
    );
    if (!patient.rows[0]) httpError('PATIENT_NOT_FOUND', 'Patient not found', 'notfound');
    if (patient.rows[0].status !== 'ACTIVE') {
      httpError('PATIENT_INACTIVE', 'Patient is inactive', 'conflict');
    }

    this.assertBookableSession(input.session);

    const booked = await this.activeCount(client, ctx.quotedSchema, input.session.id);
    if (booked >= input.session.capacity) {
      httpError('SESSION_FULL', 'Session is at capacity', 'conflict');
    }

    const dup = await client.query(
      `SELECT id FROM ${ctx.quotedSchema}.appointments
       WHERE patient_id = $1 AND session_id = $2 AND status = 'CONFIRMED'`,
      [input.patientId, input.session.id],
    );
    if ((dup.rowCount ?? 0) > 0) {
      httpError(
        'DUPLICATE_ACTIVE_BOOKING',
        'Patient already has an active booking in this session',
        'conflict',
      );
    }

    const queueNumber = input.session.next_queue_number;
    const bumped = await client.query(
      `UPDATE ${ctx.quotedSchema}.consultation_sessions
       SET next_queue_number = next_queue_number + 1,
           updated_at = NOW()
       WHERE id = $1 AND next_queue_number = $2
       RETURNING id`,
      [input.session.id, queueNumber],
    );
    if (!bumped.rows[0]) {
      httpError('CONCURRENT_MODIFICATION', 'Session changed during booking; retry', 'conflict');
    }

    const seq = await client.query<{ value: number }>(
      `UPDATE ${ctx.quotedSchema}.appointment_reg_seq
       SET value = value + 1
       WHERE name = 'appointment'
       RETURNING value`,
    );
    const next = seq.rows[0]?.value;
    if (!next) throw new Error('Appointment reference sequence missing');
    const bookingReference = formatBookingReference(next);
    const id = randomUUID();

    const inserted = await client.query<AppointmentRow>(
      `INSERT INTO ${ctx.quotedSchema}.appointments
        (id, booking_reference, patient_id, session_id, queue_number, booking_source, status,
         internal_notes, rescheduled_from_id, reschedule_reason, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,'CONFIRMED',$7,$8,$9,$10,$10)
       RETURNING *`,
      [
        id,
        bookingReference,
        input.patientId,
        input.session.id,
        queueNumber,
        input.bookingSource,
        input.internalNotes,
        input.rescheduledFromId ?? null,
        input.rescheduleReason ?? null,
        ctx.userId,
      ],
    );

    const created = inserted.rows[0]!;
    await this.queue.ensureReservedEntry(client, ctx.quotedSchema, {
      id: created.id,
      session_id: created.session_id,
      queue_number: created.queue_number,
    });
    return created;
  }

  async create(ctx: ClinicContext, dto: CreateAppointmentDto) {
    const notes = dto.internalNotes?.trim() || null;
    const hash = payloadHash(dto);

    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        if (dto.idempotencyKey) {
          const existing = await client.query<{
            appointment_id: string;
            payload_hash: string;
          }>(
            `SELECT appointment_id, payload_hash
             FROM ${ctx.quotedSchema}.appointment_idempotency
             WHERE idempotency_key = $1
             FOR UPDATE`,
            [dto.idempotencyKey],
          );
          if (existing.rows[0]) {
            if (existing.rows[0].payload_hash !== hash) {
              httpError(
                'IDEMPOTENCY_CONFLICT',
                'Idempotency key was reused with a different payload',
                'conflict',
              );
            }
            const row = await this.loadAppointment(
              client,
              ctx.quotedSchema,
              existing.rows[0].appointment_id,
            );
            await client.query('COMMIT');
            if (!row) httpError('APPOINTMENT_NOT_FOUND', 'Appointment not found', 'notfound');
            return mapAppointment(row);
          }
        }

        const session = await this.lockSession(client, ctx.quotedSchema, dto.sessionId);
        if (!session) httpError('SESSION_NOT_FOUND', 'Session not found', 'notfound');

        const created = await this.insertBooking(client, ctx, {
          patientId: dto.patientId,
          session,
          bookingSource: dto.bookingSource,
          internalNotes: notes,
        });

        if (dto.idempotencyKey) {
          await client.query(
            `INSERT INTO ${ctx.quotedSchema}.appointment_idempotency
              (idempotency_key, payload_hash, appointment_id, actor_id)
             VALUES ($1,$2,$3,$4)`,
            [dto.idempotencyKey, hash, created.id, ctx.userId],
          );
        }

        // Durable SMS outbox in the same transaction (external send happens after commit).
        await this.notifications.enqueueForAppointment(client, ctx, {
          appointmentId: created.id,
          eventType: 'BOOKING_CONFIRMATION',
          dedupeKey: `BOOKING_CONFIRMATION:${created.id}`,
          includeTrackingLink: true,
        });

        await client.query('COMMIT');
        this.smsDispatcher.kick();

        await this.audit.record({
          actorId: ctx.userId,
          action: 'appointment.created',
          targetType: 'appointment',
          targetId: created.id,
          metadata: {
            tenantId: ctx.tenantId,
            bookingReference: created.booking_reference,
            queueNumber: created.queue_number,
            sessionId: created.session_id,
            patientId: created.patient_id,
          },
        });

        return this.get(ctx, created.id);
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code === '23505') {
          httpError(
            'DUPLICATE_ACTIVE_BOOKING',
            'Patient already has an active booking in this session',
            'conflict',
          );
        }
        throw error;
      }
    });
  }

  async cancel(ctx: ClinicContext, id: string, dto: CancelAppointmentDto) {
    const reason = dto.reason.trim();
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const current = await client.query<AppointmentRow>(
          `SELECT * FROM ${ctx.quotedSchema}.appointments WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = current.rows[0];
        if (!row) httpError('APPOINTMENT_NOT_FOUND', 'Appointment not found', 'notfound');
        if (row.status === 'CANCELLED') {
          await client.query('COMMIT');
          return this.get(ctx, id);
        }
        try {
          assertTransition(row.status, 'CANCELLED');
        } catch {
          httpError('INVALID_STATUS_TRANSITION', 'Appointment cannot be cancelled', 'conflict');
        }
        await this.assertNotCheckedIn(client, ctx.quotedSchema, id, 'cancelled');

        // Lock session so capacity reads stay consistent with concurrent bookings.
        await this.lockSession(client, ctx.quotedSchema, row.session_id);

        await client.query(
          `UPDATE ${ctx.quotedSchema}.appointments SET
             status = 'CANCELLED',
             cancellation_reason = $2,
             cancelled_at = NOW(),
             cancelled_by = $3,
             updated_at = NOW(),
             updated_by = $3,
             version = version + 1
           WHERE id = $1`,
          [id, reason, ctx.userId],
        );
        await this.queue.invalidateForAppointment(client, ctx.quotedSchema, id);
        await this.notifications.enqueueForAppointment(client, ctx, {
          appointmentId: id,
          eventType: 'CANCELLATION',
          dedupeKey: `CANCELLATION:${id}`,
          includeTrackingLink: false,
          suppressPendingApproaching: true,
        });
        await client.query('COMMIT');
        this.smsDispatcher.kick();

        await this.audit.record({
          actorId: ctx.userId,
          action: 'appointment.cancelled',
          targetType: 'appointment',
          targetId: id,
          metadata: { tenantId: ctx.tenantId, reason },
        });
        return this.get(ctx, id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async reschedule(ctx: ClinicContext, id: string, dto: RescheduleAppointmentDto) {
    if (dto.newSessionId === id) {
      httpError('INVALID_STATUS_TRANSITION', 'Invalid destination session', 'bad');
    }
    const reason = dto.reason?.trim() || 'Rescheduled by clinic staff';

    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const current = await client.query<AppointmentRow>(
          `SELECT * FROM ${ctx.quotedSchema}.appointments WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const original = current.rows[0];
        if (!original) httpError('APPOINTMENT_NOT_FOUND', 'Appointment not found', 'notfound');
        try {
          assertTransition(original.status, 'RESCHEDULED');
        } catch {
          httpError('INVALID_STATUS_TRANSITION', 'Appointment cannot be rescheduled', 'conflict');
        }
        await this.assertNotCheckedIn(client, ctx.quotedSchema, original.id, 'rescheduled');
        if (original.session_id === dto.newSessionId) {
          httpError(
            'INVALID_STATUS_TRANSITION',
            'Choose a different session to reschedule',
            'conflict',
          );
        }

        // Lock sessions in deterministic UUID order to reduce deadlocks.
        const ids = [original.session_id, dto.newSessionId].sort();
        const locked = new Map<string, SessionLockRow>();
        for (const sessionId of ids) {
          const row = await this.lockSession(client, ctx.quotedSchema, sessionId);
          if (!row) httpError('SESSION_NOT_FOUND', 'Session not found', 'notfound');
          locked.set(sessionId, row);
        }
        const destination = locked.get(dto.newSessionId)!;

        await client.query(
          `UPDATE ${ctx.quotedSchema}.appointments SET
             status = 'RESCHEDULED',
             reschedule_reason = $2,
             updated_at = NOW(),
             updated_by = $3,
             version = version + 1
           WHERE id = $1 AND status = 'CONFIRMED'`,
          [id, reason, ctx.userId],
        );
        await this.queue.invalidateForAppointment(client, ctx.quotedSchema, id);

        const created = await this.insertBooking(client, ctx, {
          patientId: original.patient_id,
          session: destination,
          bookingSource: original.booking_source,
          internalNotes: original.internal_notes,
          rescheduledFromId: original.id,
          rescheduleReason: reason,
        });

        if (dto.idempotencyKey) {
          await client.query(
            `INSERT INTO ${ctx.quotedSchema}.appointment_idempotency
              (idempotency_key, payload_hash, appointment_id, actor_id)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (idempotency_key) DO NOTHING`,
            [
              dto.idempotencyKey,
              createHash('sha256').update(`${id}:${dto.newSessionId}`).digest('hex'),
              created.id,
              ctx.userId,
            ],
          );
        }

        await this.notifications.suppressApproaching(client, ctx, id);
        // Reschedule notification for the replacement booking only (not a second confirmation).
        await this.notifications.enqueueForAppointment(client, ctx, {
          appointmentId: created.id,
          eventType: 'RESCHEDULE',
          dedupeKey: `RESCHEDULE:${created.id}`,
          includeTrackingLink: true,
        });

        await client.query('COMMIT');
        this.smsDispatcher.kick();

        await this.audit.record({
          actorId: ctx.userId,
          action: 'appointment.rescheduled',
          targetType: 'appointment',
          targetId: created.id,
          metadata: {
            tenantId: ctx.tenantId,
            fromAppointmentId: id,
            toAppointmentId: created.id,
            fromSessionId: original.session_id,
            toSessionId: dto.newSessionId,
            reason,
          },
        });

        return this.get(ctx, created.id);
      } catch (error) {
        await client.query('ROLLBACK');
        if ((error as { code?: string }).code === '23505') {
          httpError(
            'DUPLICATE_ACTIVE_BOOKING',
            'Patient already has an active booking in the destination session',
            'conflict',
          );
        }
        throw error;
      }
    });
  }
}
