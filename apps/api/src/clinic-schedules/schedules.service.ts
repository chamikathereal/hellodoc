import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import type { ClinicContext } from '../clinic-context/clinic-context.service.js';
import { TenantSqlClient } from '../tenant-provisioning/tenant-sql.client.js';
import {
  BulkUpdateTemplateSessionsDto,
  CreateScheduleTemplatesDto,
  DeactivateScheduleTemplateDto,
  MaterializeScheduleDto,
} from './dto/schedule.dto.js';

const DEFAULT_TZ = 'Asia/Colombo';
const DEFAULT_HORIZON_DAYS = 90;
/** Never generate sessions further ahead than this, even after repeated "Extend upcoming". */
const MAX_HORIZON_DAYS = 365;
const TEMPLATE_DEACTIVATED_REASON = 'Weekly schedule template deactivated';
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type TemplateRow = {
  id: string;
  doctor_id: string;
  weekday: number;
  local_start_time: string;
  local_end_time: string;
  effective_from: string;
  effective_until: string | null;
  default_capacity: number;
  expected_duration_minutes: number;
  timezone: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
  created_by: string;
  updated_by: string | null;
};

function mapTemplate(row: TemplateRow) {
  return {
    id: row.id,
    doctorId: row.doctor_id,
    weekday: row.weekday,
    localStartTime: String(row.local_start_time).slice(0, 5),
    localEndTime: String(row.local_end_time).slice(0, 5),
    effectiveFrom: String(row.effective_from).slice(0, 10),
    effectiveUntil: row.effective_until ? String(row.effective_until).slice(0, 10) : null,
    defaultCapacity: row.default_capacity,
    expectedDurationMinutes: row.expected_duration_minutes,
    timezone: row.timezone,
    isActive: row.is_active,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Start/end/capacity/duration must be consistent: every booked patient must fit in the session. */
function assertSlotConfiguration(start: string, end: string, capacity: number, duration: number) {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  if (sh! > 23 || sm! > 59 || eh! > 23 || em! > 59) {
    throw new BadRequestException('Enter a valid start and end time');
  }
  const sessionMinutes = toMinutes(end) - toMinutes(start);
  if (sessionMinutes <= 0) {
    throw new BadRequestException('End time must be after start time');
  }
  if (duration > sessionMinutes) {
    throw new BadRequestException(
      `Duration (${duration} min) cannot be longer than the session (${sessionMinutes} min)`,
    );
  }
  if (capacity * duration > sessionMinutes) {
    const maxCapacity = Math.floor(sessionMinutes / duration);
    throw new BadRequestException(
      `${capacity} patients × ${duration} min = ${capacity * duration} min, but the session is only ` +
        `${sessionMinutes} min. Reduce capacity to ${maxCapacity} or less, shorten the duration, or extend the session time.`,
    );
  }
}

@Injectable()
export class SchedulesService {
  constructor(
    private readonly sql: TenantSqlClient,
    private readonly audit: AuditService,
  ) {}

  async listForDoctor(ctx: ClinicContext, doctorId: string) {
    return this.sql.withClient(async (client) => {
      await this.requireDoctor(client, ctx, doctorId);
      const result = await client.query<TemplateRow>(
        `SELECT * FROM ${ctx.quotedSchema}.schedule_templates
         WHERE doctor_id = $1
         ORDER BY weekday ASC, local_start_time ASC`,
        [doctorId],
      );
      return result.rows.map(mapTemplate);
    });
  }

  async createForDoctor(ctx: ClinicContext, doctorId: string, dto: CreateScheduleTemplatesDto) {
    const timezone = dto.timezone?.trim() || DEFAULT_TZ;
    const capacity = dto.defaultCapacity ?? 20;
    const duration = dto.expectedDurationMinutes ?? 10;

    for (const slot of dto.slots) {
      assertSlotConfiguration(slot.localStartTime, slot.localEndTime, capacity, duration);
    }

    const weekdays = dto.slots.map((slot) => slot.weekday);
    if (new Set(weekdays).size !== weekdays.length) {
      throw new BadRequestException('Each weekday can only be selected once');
    }

    return this.sql.withClient(async (client) => {
      await this.requireDoctor(client, ctx, doctorId, true);

      await client.query('BEGIN');
      const created = [];
      try {
        // Serialise schedule changes per doctor so two saves cannot both pass the duplicate check.
        await client.query(`SELECT id FROM ${ctx.quotedSchema}.doctors WHERE id = $1 FOR UPDATE`, [doctorId]);
        for (const slot of dto.slots) {
          await this.assertNoDuplicateTemplate(client, ctx, doctorId, slot.weekday, slot.localStartTime, slot.localEndTime);
        }
        for (const slot of dto.slots) {
          const id = randomUUID();
          const inserted = await client.query<TemplateRow>(
            `INSERT INTO ${ctx.quotedSchema}.schedule_templates
              (id, doctor_id, weekday, local_start_time, local_end_time, effective_from,
               effective_until, default_capacity, expected_duration_minutes, timezone,
               is_active, created_by, updated_by)
             VALUES ($1,$2,$3,$4::time,$5::time,$6::date,$7::date,$8,$9,$10,true,$11,$11)
             RETURNING *`,
            [
              id,
              doctorId,
              slot.weekday,
              slot.localStartTime,
              slot.localEndTime,
              dto.effectiveFrom,
              dto.effectiveUntil ?? null,
              capacity,
              duration,
              timezone,
              ctx.userId,
            ],
          );
          created.push(mapTemplate(inserted.rows[0]!));
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }

      await this.audit.record({
        actorId: ctx.userId,
        action: 'schedule_template.created',
        targetType: 'doctor',
        targetId: doctorId,
        metadata: { tenantId: ctx.tenantId, count: created.length },
      });

      let materializeResult = null;
      if (dto.materialize !== false) {
        materializeResult = await this.materializeTemplates(
          client,
          ctx,
          created.map((t) => t.id),
          dto.horizonDays ?? DEFAULT_HORIZON_DAYS,
        );
      }

      return { templates: created, materialize: materializeResult };
    });
  }

  async deactivate(ctx: ClinicContext, templateId: string, dto: DeactivateScheduleTemplateDto) {
    const reason = dto.reason.trim();
    if (reason.length < 3) {
      throw new BadRequestException('Reason for deactivation must be at least 3 characters');
    }
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const updated = await client.query<TemplateRow>(
          `UPDATE ${ctx.quotedSchema}.schedule_templates
           SET is_active = false, updated_by = $2, updated_at = NOW()
           WHERE id = $1 AND is_active = true
           RETURNING *`,
          [templateId, ctx.userId],
        );
        if (!updated.rows[0]) throw new NotFoundException('Active schedule template not found');

        // Cancel future, not-yet-started sessions generated from this template that have no
        // confirmed bookings, so they can no longer be booked. The occurrence key is released
        // so the dates can be generated again if the template is re-activated.
        const cancelled = await client.query<{ id: string }>(
          `UPDATE ${ctx.quotedSchema}.consultation_sessions s SET
             status = 'CANCELLED',
             cancellation_reason = $3,
             cancelled_at = NOW(),
             cancelled_by = $2,
             updated_by = $2,
             updated_at = NOW(),
             occurrence_key = NULL,
             version = version + 1
           WHERE s.schedule_template_id = $1
             AND s.status = 'SCHEDULED'
             AND s.start_at > NOW()
             AND NOT EXISTS (
               SELECT 1 FROM ${ctx.quotedSchema}.appointments a
               WHERE a.session_id = s.id AND a.status = 'CONFIRMED'
             )
           RETURNING s.id`,
          [templateId, ctx.userId, `${TEMPLATE_DEACTIVATED_REASON}: ${reason}`],
        );

        // Sessions with confirmed bookings are kept so patients are not dropped silently;
        // staff can review and cancel them from the Sessions module.
        const keptWithBookings = await client.query<{ local_date: string }>(
          `SELECT to_char(s.local_date, 'YYYY-MM-DD') AS local_date
           FROM ${ctx.quotedSchema}.consultation_sessions s
           WHERE s.schedule_template_id = $1
             AND s.status = 'SCHEDULED'
             AND s.start_at > NOW()
           ORDER BY s.start_at ASC`,
          [templateId],
        );

        await client.query('COMMIT');
        await this.audit.record({
          actorId: ctx.userId,
          action: 'schedule_template.deactivated',
          targetType: 'schedule_template',
          targetId: templateId,
          metadata: {
            tenantId: ctx.tenantId,
            reason,
            cancelledSessions: cancelled.rowCount ?? 0,
            keptSessionsWithBookings: keptWithBookings.rows.length,
          },
        });
        return {
          ...mapTemplate(updated.rows[0]),
          cancelledSessions: cancelled.rowCount ?? 0,
          keptSessionsWithBookings: keptWithBookings.rows.map((r) => r.local_date),
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async activate(ctx: ClinicContext, templateId: string) {
    return this.sql.withClient(async (client) => {
      const existing = await client.query<TemplateRow>(
        `SELECT * FROM ${ctx.quotedSchema}.schedule_templates WHERE id = $1`,
        [templateId],
      );
      const template = existing.rows[0];
      if (!template) throw new NotFoundException('Schedule template not found');
      if (template.is_active) throw new BadRequestException('Schedule template is already active');
      await this.requireDoctor(client, ctx, template.doctor_id, true);
      await this.assertNoDuplicateTemplate(
        client,
        ctx,
        template.doctor_id,
        template.weekday,
        String(template.local_start_time).slice(0, 5),
        String(template.local_end_time).slice(0, 5),
        template.id,
        true,
      );

      const updated = await client.query<TemplateRow>(
        `UPDATE ${ctx.quotedSchema}.schedule_templates
         SET is_active = true, updated_by = $2, updated_at = NOW()
         WHERE id = $1 AND is_active = false
         RETURNING *`,
        [templateId, ctx.userId],
      );
      if (!updated.rows[0]) throw new BadRequestException('Schedule template is already active');

      const materializeResult = await this.materializeTemplates(
        client,
        ctx,
        [templateId],
        DEFAULT_HORIZON_DAYS,
      );
      await this.audit.record({
        actorId: ctx.userId,
        action: 'schedule_template.activated',
        targetType: 'schedule_template',
        targetId: templateId,
        metadata: { tenantId: ctx.tenantId, created: materializeResult.created },
      });
      return { template: mapTemplate(updated.rows[0]), materialize: materializeResult };
    });
  }

  /**
   * Sets a new capacity and duration on a template and on all of its upcoming SCHEDULED sessions.
   * A session is skipped (left unchanged) when the new values do not fit its time, or when it
   * already has more confirmed bookings than the new capacity.
   */
  async bulkUpdateSessions(ctx: ClinicContext, templateId: string, dto: BulkUpdateTemplateSessionsDto) {
    const capacity = dto.capacity;
    const duration = dto.expectedDurationMinutes;
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const existing = await client.query<TemplateRow>(
          `SELECT * FROM ${ctx.quotedSchema}.schedule_templates WHERE id = $1 FOR UPDATE`,
          [templateId],
        );
        const template = existing.rows[0];
        if (!template) throw new NotFoundException('Schedule template not found');
        assertSlotConfiguration(
          String(template.local_start_time).slice(0, 5),
          String(template.local_end_time).slice(0, 5),
          capacity,
          duration,
        );

        const updatedTemplate = await client.query<TemplateRow>(
          `UPDATE ${ctx.quotedSchema}.schedule_templates
           SET default_capacity = $2, expected_duration_minutes = $3, updated_by = $4, updated_at = NOW()
           WHERE id = $1
           RETURNING *`,
          [templateId, capacity, duration, ctx.userId],
        );

        const sessions = await client.query<{
          id: string;
          local_date: string;
          session_minutes: number;
          booked: number;
        }>(
          `SELECT s.id,
                  to_char(s.local_date, 'YYYY-MM-DD') AS local_date,
                  (EXTRACT(EPOCH FROM (s.end_at - s.start_at)) / 60)::int AS session_minutes,
                  (SELECT count(*)::int FROM ${ctx.quotedSchema}.appointments a
                   WHERE a.session_id = s.id AND a.status = 'CONFIRMED') AS booked
           FROM ${ctx.quotedSchema}.consultation_sessions s
           WHERE s.schedule_template_id = $1
             AND s.status = 'SCHEDULED'
             AND s.start_at > NOW()
           ORDER BY s.start_at ASC
           FOR UPDATE OF s`,
          [templateId],
        );

        let updated = 0;
        const skipped: Array<{ date: string; reason: string }> = [];
        for (const row of sessions.rows) {
          if (capacity < row.booked) {
            skipped.push({
              date: row.local_date,
              reason: `${row.booked} patient(s) already booked, more than the new capacity`,
            });
            continue;
          }
          if (duration > row.session_minutes || capacity * duration > row.session_minutes) {
            skipped.push({
              date: row.local_date,
              reason: `${capacity} patients × ${duration} min does not fit in this ${row.session_minutes} min session`,
            });
            continue;
          }
          await client.query(
            `UPDATE ${ctx.quotedSchema}.consultation_sessions SET
               capacity = $2,
               expected_duration_minutes = $3,
               updated_by = $4,
               updated_at = NOW(),
               version = version + 1
             WHERE id = $1 AND status = 'SCHEDULED'`,
            [row.id, capacity, duration, ctx.userId],
          );
          updated += 1;
        }

        await client.query('COMMIT');
        await this.audit.record({
          actorId: ctx.userId,
          action: 'schedule_template.sessions_bulk_updated',
          targetType: 'schedule_template',
          targetId: templateId,
          metadata: {
            tenantId: ctx.tenantId,
            capacity,
            expectedDurationMinutes: duration,
            updatedSessions: updated,
            skippedSessions: skipped.length,
          },
        });
        return { template: mapTemplate(updatedTemplate.rows[0]!), updatedSessions: updated, skipped };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async materialize(ctx: ClinicContext, templateId: string, dto: MaterializeScheduleDto) {
    const horizonDays = dto.horizonDays ?? DEFAULT_HORIZON_DAYS;
    return this.sql.withClient(async (client) => {
      const template = await client.query<TemplateRow>(
        `SELECT * FROM ${ctx.quotedSchema}.schedule_templates WHERE id = $1`,
        [templateId],
      );
      if (!template.rows[0]) throw new NotFoundException('Schedule template not found');
      if (!template.rows[0].is_active) {
        throw new BadRequestException('Inactive templates cannot generate sessions');
      }
      const result = await this.materializeTemplates(client, ctx, [templateId], horizonDays, {
        extend: true,
      });
      await this.audit.record({
        actorId: ctx.userId,
        action: 'schedule_template.materialized',
        targetType: 'schedule_template',
        targetId: templateId,
        metadata: { tenantId: ctx.tenantId, ...result },
      });
      return result;
    });
  }

  private async materializeTemplates(
    client: {
      query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;
    },
    ctx: ClinicContext,
    templateIds: string[],
    horizonDays: number,
    options: { extend?: boolean } = {},
  ) {
    let created = 0;
    let skippedExisting = 0;
    let skippedConflicts = 0;
    let generatedThrough: string | null = null;
    const conflicts: Array<{ date: string; templateId: string; message: string }> = [];

    for (const templateId of templateIds) {
      const templateRes = await client.query(
        `SELECT * FROM ${ctx.quotedSchema}.schedule_templates WHERE id = $1`,
        [templateId],
      );
      const template = templateRes.rows[0] as TemplateRow | undefined;
      if (!template || !template.is_active) continue;

      const doctor = await client.query(
        `SELECT status FROM ${ctx.quotedSchema}.doctors WHERE id = $1`,
        [template.doctor_id],
      );
      if (!doctor.rows[0] || doctor.rows[0].status !== 'ACTIVE') continue;

      // Window end: horizonDays from today, or, when extending, horizonDays past the last
      // session already generated from this template. Never beyond MAX_HORIZON_DAYS from today.
      let anchor: string | null = null;
      if (options.extend) {
        const last = await client.query(
          `SELECT to_char(MAX(local_date), 'YYYY-MM-DD') AS last_date
           FROM ${ctx.quotedSchema}.consultation_sessions
           WHERE schedule_template_id = $1 AND occurrence_key IS NOT NULL`,
          [template.id],
        );
        anchor = (last.rows[0]?.last_date as string | null) ?? null;
      }
      const windowEnd = await client.query(
        `SELECT to_char(
           LEAST(
             GREATEST(CURRENT_DATE, COALESCE($1::date, CURRENT_DATE)) + $2::int,
             CURRENT_DATE + $3::int,
             COALESCE($4::date, 'infinity'::date)
           ),
           'YYYY-MM-DD'
         ) AS end_date`,
        [anchor, horizonDays, MAX_HORIZON_DAYS, template.effective_until],
      );
      const endDate = windowEnd.rows[0]?.end_date as string;
      if (!generatedThrough || endDate > generatedThrough) generatedThrough = endDate;

      const dates = await client.query(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS d
         FROM generate_series(
           GREATEST($1::date, CURRENT_DATE),
           $2::date,
           '1 day'::interval
         ) AS g(d)
         WHERE EXTRACT(DOW FROM d) = $3`,
        [template.effective_from, endDate, template.weekday],
      );

      for (const row of dates.rows as Array<{ d: string }>) {
        const d = row.d;
        const occurrenceKey = `${template.id}:${d}`;
        const existing = await client.query(
          `SELECT 1 FROM ${ctx.quotedSchema}.consultation_sessions WHERE occurrence_key = $1`,
          [occurrenceKey],
        );
        if ((existing.rowCount ?? 0) > 0) {
          skippedExisting += 1;
          continue;
        }

        const bounds = await client.query(
          `SELECT
             (($1::date + $2::time) AT TIME ZONE $4) AS start_at,
             (($1::date + $3::time) AT TIME ZONE $4) AS end_at`,
          [
            d,
            String(template.local_start_time).slice(0, 8),
            String(template.local_end_time).slice(0, 8),
            template.timezone || DEFAULT_TZ,
          ],
        );
        const startAt = bounds.rows[0]?.start_at as Date | undefined;
        const endAt = bounds.rows[0]?.end_at as Date | undefined;
        if (!startAt || !endAt || startAt.getTime() <= Date.now()) {
          skippedExisting += 1;
          continue;
        }

        try {
          await client.query(
            `INSERT INTO ${ctx.quotedSchema}.consultation_sessions
              (id, doctor_id, local_date, start_at, end_at, timezone, capacity,
               expected_duration_minutes, status, schedule_template_id, occurrence_key,
               created_by, updated_by)
             VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,'SCHEDULED',$9,$10,$11,$11)`,
            [
              randomUUID(),
              template.doctor_id,
              d,
              startAt,
              endAt,
              template.timezone || DEFAULT_TZ,
              template.default_capacity,
              template.expected_duration_minutes,
              template.id,
              occurrenceKey,
              ctx.userId,
            ],
          );
          created += 1;
        } catch (error) {
          if ((error as { code?: string }).code === '23P01') {
            skippedConflicts += 1;
            conflicts.push({
              date: d,
              templateId: template.id,
              message: 'Overlaps an existing session',
            });
            continue;
          }
          throw error;
        }
      }
    }

    return {
      created,
      skippedExisting,
      skippedConflicts,
      conflicts,
      horizonDays,
      generatedThrough,
    };
  }

  /**
   * Rejects a weekday slot that duplicates an existing template for the doctor (same weekday and
   * times, active or inactive) or overlaps an active template on that weekday.
   * With activeOnly (used when activating), only active templates count.
   */
  private async assertNoDuplicateTemplate(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> },
    ctx: ClinicContext,
    doctorId: string,
    weekday: number,
    start: string,
    end: string,
    excludeTemplateId?: string,
    activeOnly = false,
  ) {
    const existing = await client.query(
      `SELECT id, is_active,
              to_char(local_start_time, 'HH24:MI') AS start_time,
              to_char(local_end_time, 'HH24:MI') AS end_time
       FROM ${ctx.quotedSchema}.schedule_templates
       WHERE doctor_id = $1 AND weekday = $2
         AND ($5::uuid IS NULL OR id <> $5::uuid)
         AND (
           (local_start_time = $3::time AND local_end_time = $4::time AND ($6::boolean = false OR is_active))
           OR (is_active AND local_start_time < $4::time AND local_end_time > $3::time)
         )
       ORDER BY (local_start_time = $3::time AND local_end_time = $4::time) DESC, is_active DESC
       LIMIT 1`,
      [doctorId, weekday, start, end, excludeTemplateId ?? null, activeOnly],
    );
    const row = existing.rows[0] as { is_active: boolean; start_time: string; end_time: string } | undefined;
    if (!row) return;
    const day = WEEKDAY_NAMES[weekday] ?? 'This weekday';
    if (row.start_time === start && row.end_time === end) {
      throw new ConflictException(
        row.is_active
          ? `This schedule has already been created (${day} ${start}–${end}).`
          : `This schedule has already been created (${day} ${start}–${end}) but is inactive. Activate it instead.`,
      );
    }
    throw new ConflictException(
      `${day} ${start}–${end} overlaps the existing active schedule ${row.start_time}–${row.end_time}.`,
    );
  }

  private async requireDoctor(
    client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> },
    ctx: ClinicContext,
    doctorId: string,
    requireActive = false,
  ) {
    const doctor = await client.query(
      `SELECT id, status FROM ${ctx.quotedSchema}.doctors WHERE id = $1`,
      [doctorId],
    );
    if (!doctor.rows[0]) throw new NotFoundException('Doctor not found');
    if (requireActive && doctor.rows[0].status !== 'ACTIVE') {
      throw new BadRequestException('Inactive doctors cannot receive schedule templates');
    }
  }
}
