import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { AuditService } from '../audit/audit.service.js';
import type { ClinicContext } from '../clinic-context/clinic-context.service.js';
import {
  type ActiveMembership,
  EMAIL_ALREADY_REGISTERED_MESSAGE,
  hasConflictingClinicMembership,
} from '../common/clinic-account-email.js';
import { normalizeEmail } from '../common/identifiers.js';
import {
  compareMoney,
  csvCell,
  formatCents,
  lineAmounts,
  parseMoneyToCents,
  subtractMoney,
  sumCents,
} from '../common/money.js';
import { PasswordService } from '../common/password.service.js';
import { validatePasswordStrength } from '../common/password-policy.js';
import { PrismaPlatformService } from '../platform/prisma-platform.service.js';
import { TenantSqlClient } from '../tenant-provisioning/tenant-sql.client.js';
import { buildCategoryReport, type ReportCategory } from './category-reports.js';
import type {
  AcceptStaffInviteDto,
  BillingSettingsDto,
  CreateInvoiceDto,
  CreateServiceDto,
  CreditNoteDto,
  InviteCashierDto,
  ListQueryDto,
  RecordPaymentDto,
  RefundDto,
  SaveInvoiceDraftDto,
  UpdateServiceDto,
  VoidInvoiceDto,
} from './dto/billing.dto.js';

type MoneyRow = {
  paid: string;
  refunded: string;
  credits: string;
  invoice_total: string;
  status: string;
};

function fail(code: string, message: string, kind: 'bad' | 'forbidden' | 'missing' | 'conflict' = 'bad'): never {
  const body = { code, message };
  if (kind === 'forbidden') throw new ForbiddenException(body);
  if (kind === 'missing') throw new NotFoundException(body);
  if (kind === 'conflict') throw new ConflictException(body);
  throw new BadRequestException(body);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function settlement(row: MoneyRow): {
  netPaid: string;
  obligation: string;
  balance: string;
  excessToReconcile: string;
  settlement: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'EXCESS_RECEIVED' | 'VOIDED';
} {
  if (row.status === 'VOIDED') {
    return {
      netPaid: '0.00',
      obligation: '0.00',
      balance: '0.00',
      excessToReconcile: '0.00',
      settlement: 'VOIDED',
    };
  }
  const netPaid = subtractMoney(row.paid, row.refunded);
  const obligation = subtractMoney(row.invoice_total, row.credits);
  const balance = subtractMoney(obligation, netPaid);
  const cmp = compareMoney(balance, '0.00');
  let label: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'EXCESS_RECEIVED' = 'UNPAID';
  if (cmp < 0) label = 'EXCESS_RECEIVED';
  else if (cmp === 0) label = 'PAID';
  else if (compareMoney(netPaid, '0.00') > 0) label = 'PARTIALLY_PAID';
  return {
    netPaid,
    obligation,
    balance: cmp < 0 ? '0.00' : balance,
    excessToReconcile: cmp < 0 ? formatCents(-parseMoneyToCents(balance)) : '0.00',
    settlement: label,
  };
}

@Injectable()
export class BillingService {
  constructor(
    private readonly sql: TenantSqlClient,
    private readonly prisma: PrismaPlatformService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
  ) {}

  async inviteCashier(ctx: ClinicContext, dto: InviteCashierDto) {
    return this.inviteStaff(ctx, dto.email, 'CLINIC_CASHIER');
  }

  async inviteReceptionist(ctx: ClinicContext, dto: InviteCashierDto) {
    return this.inviteStaff(ctx, dto.email, 'CLINIC_RECEPTIONIST');
  }

  /** See hasConflictingClinicMembership: a second clinic membership locks the user out of login. */
  private async assertEmailAvailableForStaff(emailNormalized: string, allow?: ActiveMembership) {
    const existing = await this.prisma.platformUser.findUnique({
      where: { emailNormalized },
      select: { memberships: { where: { active: true }, select: { tenantId: true, role: true } } },
    });
    if (hasConflictingClinicMembership(existing?.memberships ?? [], allow)) {
      fail('EMAIL_ALREADY_REGISTERED', EMAIL_ALREADY_REGISTERED_MESSAGE, 'conflict');
    }
  }

  private async inviteStaff(ctx: ClinicContext, emailInput: string, role: 'CLINIC_CASHIER' | 'CLINIC_RECEPTIONIST') {
    const email = normalizeEmail(emailInput);
    await this.assertEmailAvailableForStaff(email);
    const raw = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(raw).digest('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
    await this.prisma.$executeRawUnsafe(
      `UPDATE platform.staff_invitations
       SET revoked_at = NOW()
       WHERE tenant_id = $1::uuid AND email_normalized = $2 AND role = $3
         AND accepted_at IS NULL AND revoked_at IS NULL`,
      ctx.tenantId,
      email,
      role,
    );
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO platform.staff_invitations
        (id, token_hash, tenant_id, role, email_normalized, expires_at, created_by)
       VALUES ($1::uuid, $2, $3::uuid, $4, $5, $6, $7::uuid)`,
      randomUUID(),
      tokenHash,
      ctx.tenantId,
      role,
      email,
      expiresAt,
      ctx.userId,
    );
    await this.audit.record({
      actorId: ctx.userId,
      action: 'cashier.invited',
      targetType: 'tenant',
      targetId: ctx.tenantId,
      metadata: { email },
    });
    const origin = (process.env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:5173').split(',')[0]!.trim();
    const path = role === 'CLINIC_RECEPTIONIST' ? '/receptionist/accept' : '/cashier/accept';
    return { acceptUrl: `${origin}${path}?token=${raw}`, expiresAt: expiresAt.toISOString() };
  }

  async acceptCashier(dto: AcceptStaffInviteDto) {
    const weakness = validatePasswordStrength(dto.password);
    if (weakness) fail('BILLING_ACCESS_DENIED', weakness);
    const tokenHash = createHash('sha256').update(dto.token).digest('hex');
    const rows = await this.prisma.$queryRawUnsafe<
      Array<{ id: string; tenant_id: string; email_normalized: string; expires_at: Date; role: string }>
    >(
      `SELECT id, tenant_id, email_normalized, expires_at, role
       FROM platform.staff_invitations
       WHERE token_hash = $1 AND accepted_at IS NULL AND revoked_at IS NULL
         AND role IN ('CLINIC_CASHIER', 'CLINIC_RECEPTIONIST')
       LIMIT 1`,
      tokenHash,
    );
    const invite = rows[0];
    if (!invite || new Date(invite.expires_at).getTime() < Date.now()) {
      fail('BILLING_ACCESS_DENIED', 'Invitation is invalid or expired', 'forbidden');
    }
    // Re-check at acceptance: the email may have been registered after the invitation was sent.
    await this.assertEmailAvailableForStaff(invite.email_normalized, {
      tenantId: invite.tenant_id,
      role: invite.role,
    });
    const passwordHash = await this.passwords.hash(dto.password);
    let user = await this.prisma.platformUser.findUnique({
      where: { emailNormalized: invite.email_normalized },
    });
    if (!user) {
      user = await this.prisma.platformUser.create({
        data: {
          name: dto.name.trim(),
          email: invite.email_normalized,
          emailNormalized: invite.email_normalized,
          passwordHash,
        },
      });
    } else {
      const ok = await this.passwords.verify(user.passwordHash, dto.password);
      if (!ok) fail('BILLING_ACCESS_DENIED', 'Existing account password did not match', 'forbidden');
    }
    await this.prisma.tenantMembership.upsert({
      where: {
        tenantId_userId_role: {
          tenantId: invite.tenant_id,
          userId: user.id,
          role: invite.role,
        },
      },
      update: { active: true },
      create: { tenantId: invite.tenant_id, userId: user.id, role: invite.role },
    });
    await this.prisma.$executeRawUnsafe(
      `UPDATE platform.staff_invitations SET accepted_at = NOW() WHERE id = $1::uuid AND accepted_at IS NULL`,
      invite.id,
    );
    await this.audit.record({
      actorId: user.id,
      action: 'cashier.invitation_accepted',
      targetType: 'tenant',
      targetId: invite.tenant_id,
    });
    return { accepted: true };
  }

  async getSettings(ctx: ClinicContext) {
    return this.sql.withClient(async (client) => {
      const row = await client.query(`SELECT * FROM ${ctx.quotedSchema}.billing_settings WHERE id = TRUE`);
      return this.mapSettings(row.rows[0] as Record<string, unknown>);
    });
  }

  async updateSettings(ctx: ClinicContext, dto: BillingSettingsDto) {
    const taxRegistered = dto.taxRegistered ?? false;
    if (dto.documentMode === 'VAT_TAX_INVOICE' && dto.taxRegistered === false) {
      fail('BILLING_ACCESS_DENIED', 'VAT tax invoices require confirmed tax registration');
    }
    const updated = await this.sql.withClient(async (client) => {
      const current = await client.query(`SELECT * FROM ${ctx.quotedSchema}.billing_settings WHERE id = TRUE`);
      const row = current.rows[0] as Record<string, unknown> | undefined;
      if (!row) fail('INVOICE_NOT_FOUND', 'Billing settings are missing', 'missing');
      const nextTax = dto.taxRegistered ?? Boolean(row.tax_registered);
      const nextMode = dto.documentMode ?? String(row.document_mode);
      if (nextMode === 'VAT_TAX_INVOICE' && !nextTax) {
        fail('BILLING_ACCESS_DENIED', 'VAT tax invoices require confirmed tax registration');
      }
      const result = await client.query(
        `UPDATE ${ctx.quotedSchema}.billing_settings SET
           display_name = COALESCE($1, display_name),
           address = COALESCE($2, address),
           contact = COALESCE($3, contact),
           invoice_prefix = COALESCE($4, invoice_prefix),
           receipt_prefix = COALESCE($5, receipt_prefix),
           credit_prefix = COALESCE($6, credit_prefix),
           default_service_id = COALESCE($7::uuid, default_service_id),
           allowed_methods = COALESCE($8::text[], allowed_methods),
           cashier_may_discount = COALESCE($9, cashier_may_discount),
           receipt_footer = COALESCE($10, receipt_footer),
           tax_registered = $11,
           tax_registration_no = $12,
           vat_rate = $13,
           document_mode = $14,
           updated_at = NOW(),
           updated_by = $15
         WHERE id = TRUE
         RETURNING *`,
        [
          dto.displayName ?? null,
          dto.address ?? null,
          dto.contact ?? null,
          dto.invoicePrefix ?? null,
          dto.receiptPrefix ?? null,
          dto.creditPrefix ?? null,
          dto.defaultServiceId ?? null,
          dto.allowedMethods ?? null,
          dto.cashierMayDiscount ?? null,
          dto.receiptFooter ?? null,
          nextTax,
          nextTax ? (dto.taxRegistrationNo ?? row.tax_registration_no ?? null) : null,
          nextTax ? (dto.vatRate ?? (row.vat_rate != null ? String(row.vat_rate) : null)) : null,
          nextMode === 'VAT_TAX_INVOICE' && nextTax ? 'VAT_TAX_INVOICE' : 'ORDINARY_RECEIPT',
          ctx.userId,
        ],
      );
      await this.auditBilling(client, ctx, 'billing.settings_updated', 'settings', null, {});
      return result.rows[0] as Record<string, unknown>;
    });
    await this.audit.record({
      actorId: ctx.userId,
      action: 'billing.settings_updated',
      targetType: 'tenant',
      targetId: ctx.tenantId,
    });
    return this.mapSettings(updated);
  }

  async listServices(ctx: ClinicContext) {
    return this.sql.withClient(async (client) => {
      // Ensure standard clinic billing services exist
      await client.query(
        `INSERT INTO ${ctx.quotedSchema}.billing_services (id, code, name, description, price, currency, tax_classification, active, created_by)
         VALUES
           (gen_random_uuid(), 'DOC_CONSULT', 'Doctor Consultation Fee', 'General practitioner or specialist consultation', 1500.00, 'LKR', 'EXEMPT', true, $1),
           (gen_random_uuid(), 'CLINIC_FEE', 'Clinic / Facility Fee', 'Standard clinic operational and dispensary facility charge', 500.00, 'LKR', 'EXEMPT', true, $1),
           (gen_random_uuid(), 'MEDICINES', 'Medicines / Pharmacy', 'Dispensed prescription medications and pharmaceutical supplies', 0.00, 'LKR', 'EXEMPT', true, $1),
           (gen_random_uuid(), 'NURSING_PROCEDURE', 'Clinical Procedures / Dressing', 'Wound dressing, injections, minor suturing or nursing care', 750.00, 'LKR', 'EXEMPT', true, $1),
           (gen_random_uuid(), 'LAB_INVESTIGATION', 'Laboratory & Diagnostic Tests', 'Diagnostic investigations, rapid blood tests, and lab screening', 1200.00, 'LKR', 'EXEMPT', true, $1),
           (gen_random_uuid(), 'MEDICAL_CERTIFICATE', 'Medical Certificate / Report', 'Issuance of official clinical certificate or fitness report', 500.00, 'LKR', 'EXEMPT', true, $1),
           (gen_random_uuid(), 'OTHER_SERVICES', 'Other Clinical Services', 'Miscellaneous clinical care, consumables, or specialized service', 0.00, 'LKR', 'EXEMPT', true, $1)
         ON CONFLICT (code) DO NOTHING`,
        [ctx.userId],
      );

      const rows = await client.query(
        `SELECT id, code, name, description, price::text, currency, tax_classification, active
         FROM ${ctx.quotedSchema}.billing_services ORDER BY name ASC`,
      );
      return { items: rows.rows };
    });
  }

  async createService(ctx: ClinicContext, dto: CreateServiceDto) {
    parseMoneyToCents(dto.price, 'price');
    const id = randomUUID();
    try {
      await this.sql.withClient(async (client) => {
        await client.query(
          `INSERT INTO ${ctx.quotedSchema}.billing_services
            (id, code, name, description, price, tax_classification, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, dto.code, dto.name.trim(), dto.description?.trim() || null, dto.price, dto.taxClassification ?? 'UNCLASSIFIED', ctx.userId],
        );
        await this.auditBilling(client, ctx, 'billing.service_created', 'service', id, { price: dto.price });
      });
    } catch (error) {
      this.rethrowPg(error);
    }
    return { id };
  }

  async updateService(ctx: ClinicContext, id: string, dto: UpdateServiceDto) {
    if (dto.price) parseMoneyToCents(dto.price, 'price');
    const row = await this.sql.withClient(async (client) => {
      const result = await client.query(
        `UPDATE ${ctx.quotedSchema}.billing_services SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           price = COALESCE($4, price),
           tax_classification = COALESCE($5, tax_classification),
           active = COALESCE($6, active),
           updated_at = NOW()
         WHERE id = $1
         RETURNING id, price::text`,
        [id, dto.name ?? null, dto.description ?? null, dto.price ?? null, dto.taxClassification ?? null, dto.active ?? null],
      );
      if (!result.rows[0]) fail('INVOICE_NOT_FOUND', 'Service not found', 'missing');
      await this.auditBilling(client, ctx, 'billing.service_price_changed', 'service', id, { price: dto.price ?? null });
      return result.rows[0];
    });
    return row;
  }

  async getService(ctx: ClinicContext, id: string) {
    return this.sql.withClient(async (client) => {
      const rows = await client.query(
        `SELECT id, code, name, description, price::text, currency, tax_classification, active, created_at, updated_at
         FROM ${ctx.quotedSchema}.billing_services WHERE id = $1`,
        [id],
      );
      if (!rows.rows[0]) fail('INVOICE_NOT_FOUND', 'Service not found', 'missing');
      return rows.rows[0];
    });
  }

  async deleteService(ctx: ClinicContext, id: string) {
    return this.sql.withClient(async (client) => {
      const existing = await client.query<{ id: string; code: string; name: string; active: boolean }>(
        `SELECT id, code, name, active FROM ${ctx.quotedSchema}.billing_services WHERE id = $1`,
        [id],
      );
      if (!existing.rows[0]) fail('INVOICE_NOT_FOUND', 'Service not found', 'missing');

      // Check if referenced in historical invoices
      const usage = await client.query<{ count: string }>(
        `SELECT count(*)::text as count FROM ${ctx.quotedSchema}.invoice_items WHERE service_id = $1`,
        [id],
      );
      const usedInInvoices = Number(usage.rows[0]?.count ?? 0) > 0;

      if (usedInInvoices) {
        await client.query(
          `UPDATE ${ctx.quotedSchema}.billing_services SET active = FALSE, updated_at = NOW() WHERE id = $1`,
          [id],
        );
        await this.auditBilling(client, ctx, 'billing.service_deactivated', 'service', id, {
          reason: 'invoice_item_history_preserved',
        });
        return {
          deleted: false,
          deactivated: true,
          message: 'Service is linked to historical invoices. It has been deactivated to preserve financial records.',
        };
      }

      await client.query(
        `DELETE FROM ${ctx.quotedSchema}.billing_services WHERE id = $1`,
        [id],
      );
      await this.auditBilling(client, ctx, 'billing.service_deleted', 'service', id, {
        code: existing.rows[0].code,
        name: existing.rows[0].name,
      });
      return {
        deleted: true,
        deactivated: false,
        message: 'Service deleted permanently.',
      };
    });
  }

  async listInvoices(ctx: ClinicContext, query: ListQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return this.sql.withClient(async (client) => {
      const rows = await client.query(
        `SELECT i.id, i.invoice_number, i.status, i.invoice_total::text, i.issued_at, i.created_at,
                p.full_name AS patient_name, p.patient_number,
                COALESCE((SELECT SUM(amount) FROM ${ctx.quotedSchema}.payments pay WHERE pay.invoice_id = i.id),0)::text AS paid,
                COALESCE((SELECT SUM(r.amount) FROM ${ctx.quotedSchema}.payment_refunds r
                           JOIN ${ctx.quotedSchema}.payments pay ON pay.id = r.payment_id
                           WHERE pay.invoice_id = i.id),0)::text AS refunded,
                COALESCE((SELECT SUM(amount) FROM ${ctx.quotedSchema}.invoice_credit_notes c WHERE c.invoice_id = i.id),0)::text AS credits
         FROM ${ctx.quotedSchema}.invoices i
         JOIN ${ctx.quotedSchema}.patients p ON p.id = i.patient_id
         WHERE ($1::text IS NULL OR i.invoice_number ILIKE $1 OR p.full_name ILIKE $1 OR p.patient_number ILIKE $1)
           AND ($2::date IS NULL OR (COALESCE(i.issued_at, i.created_at) AT TIME ZONE 'Asia/Colombo')::date >= $2::date)
           AND ($3::date IS NULL OR (COALESCE(i.issued_at, i.created_at) AT TIME ZONE 'Asia/Colombo')::date <= $3::date)
           AND ($4::text IS NULL OR i.status = $4)
         ORDER BY i.created_at DESC
         LIMIT $5 OFFSET $6`,
        [
          query.q ? `%${query.q}%` : null,
          query.from ?? null,
          query.to ?? null,
          query.status && ['DRAFT', 'ISSUED', 'VOIDED'].includes(query.status) ? query.status : null,
          limit,
          offset,
        ],
      );
      const items = rows.rows.map((row) => {
        const money = settlement(row as MoneyRow);
        return {
          id: row.id,
          invoiceNumber: row.invoice_number,
          patientName: row.patient_name,
          patientNumber: row.patient_number,
          status: row.status,
          invoiceTotal: row.invoice_total,
          paid: money.netPaid,
          balance: money.balance,
          settlement: money.settlement,
          issuedAt: row.issued_at,
          createdAt: row.created_at,
        };
      }).filter((item) => {
        if (!query.status || ['DRAFT', 'ISSUED', 'VOIDED'].includes(query.status)) return true;
        return item.settlement === query.status;
      });
      return { items, limit, offset };
    });
  }

  async createInvoice(ctx: ClinicContext, dto: CreateInvoiceDto) {
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const id = randomUUID();
        await this.assertPatientAppointment(client, ctx, dto.patientId, dto.appointmentId);
        await client.query(
          `INSERT INTO ${ctx.quotedSchema}.invoices (id, appointment_id, patient_id, created_by)
           VALUES ($1,$2,$3,$4)`,
          [id, dto.appointmentId ?? null, dto.patientId, ctx.userId],
        );
        await this.replaceItems(client, ctx, id, dto.items, 1);
        await this.auditBilling(client, ctx, 'billing.invoice_created', 'invoice', id, {});
        await client.query('COMMIT');
        return this.getInvoice(ctx, id);
      } catch (error) {
        await client.query('ROLLBACK');
        this.rethrowPg(error);
      }
    });
  }

  /**
   * Appointments ready for the cashier in POS: the doctor has signed the prescription and the
   * appointment has no invoice yet (voided invoices do not count).
   */
  async listBillableAppointments(ctx: ClinicContext) {
    return this.sql.withClient(async (client) => {
      const rows = await client.query<{
        appointment_id: string;
        booking_reference: string;
        queue_number: number;
        patient_id: string;
        patient_name: string;
        patient_number: string;
        doctor_name: string;
        local_date: string;
        start_at: Date;
        end_at: Date;
        prescription_id: string;
        signed_at: Date | null;
        medicines: Array<{ medicine_name: string; dose: string | null; frequency: string | null }> | null;
      }>(
        `SELECT DISTINCT ON (a.id)
                a.id AS appointment_id,
                a.booking_reference,
                a.queue_number,
                a.patient_id,
                pt.full_name AS patient_name,
                pt.patient_number,
                d.display_name AS doctor_name,
                to_char(s.local_date, 'YYYY-MM-DD') AS local_date,
                s.start_at,
                s.end_at,
                p.id AS prescription_id,
                p.signed_at,
                (
                  SELECT json_agg(
                    json_build_object('medicine_name', i.medicine_name, 'dose', i.dose, 'frequency', i.frequency)
                    ORDER BY i.sort_order
                  )
                  FROM ${ctx.quotedSchema}.prescription_items i
                  WHERE i.prescription_id = p.id
                ) AS medicines
         FROM ${ctx.quotedSchema}.prescriptions p
         JOIN ${ctx.quotedSchema}.clinical_encounters e ON e.id = p.encounter_id
         JOIN ${ctx.quotedSchema}.appointments a ON a.id = e.appointment_id
         JOIN ${ctx.quotedSchema}.patients pt ON pt.id = a.patient_id
         JOIN ${ctx.quotedSchema}.consultation_sessions s ON s.id = a.session_id
         JOIN ${ctx.quotedSchema}.doctors d ON d.id = s.doctor_id
         WHERE p.status = 'SIGNED'
           AND a.status = 'CONFIRMED'
           AND pt.status = 'ACTIVE'
           AND NOT EXISTS (
             SELECT 1 FROM ${ctx.quotedSchema}.invoices inv
             WHERE inv.appointment_id = a.id AND inv.status <> 'VOIDED'
           )
         ORDER BY a.id, p.signed_at DESC NULLS LAST`,
      );
      const items = rows.rows
        .map((r) => ({
          appointmentId: r.appointment_id,
          bookingReference: r.booking_reference,
          queueDisplay: String(r.queue_number).padStart(3, '0'),
          patientId: r.patient_id,
          patientName: r.patient_name,
          patientNumber: r.patient_number,
          doctorName: r.doctor_name,
          localDate: r.local_date,
          startAt: r.start_at.toISOString(),
          endAt: r.end_at.toISOString(),
          prescriptionId: r.prescription_id,
          signedAt: r.signed_at ? r.signed_at.toISOString() : null,
          medicines: r.medicines ?? [],
        }))
        .sort((x, y) => (y.signedAt ?? '').localeCompare(x.signedAt ?? ''))
        .slice(0, 200);
      return { items };
    });
  }

  async getInvoice(ctx: ClinicContext, id: string) {
    return this.sql.withClient(async (client) => this.loadInvoice(client, ctx, id));
  }

  async saveDraft(ctx: ClinicContext, id: string, dto: SaveInvoiceDraftDto) {
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const locked = await client.query(
          `SELECT status, version FROM ${ctx.quotedSchema}.invoices WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = locked.rows[0] as { status: string; version: number } | undefined;
        if (!row) fail('INVOICE_NOT_FOUND', 'Invoice not found', 'missing');
        if (row.status !== 'DRAFT') fail('INVOICE_NOT_EDITABLE', 'Issued invoices cannot be edited', 'conflict');
        if (row.version !== dto.version) fail('VERSION_CONFLICT', 'Invoice was updated elsewhere', 'conflict');
        await client.query(
          `UPDATE ${ctx.quotedSchema}.invoices
           SET patient_id = $2, appointment_id = $3, updated_at = NOW()
           WHERE id = $1`,
          [id, dto.patientId, dto.appointmentId ?? null],
        );
        await this.assertPatientAppointment(client, ctx, dto.patientId, dto.appointmentId);
        await this.replaceItems(client, ctx, id, dto.items, dto.version);
        await client.query('COMMIT');
        return this.loadInvoice(client, ctx, id);
      } catch (error) {
        await client.query('ROLLBACK');
        this.rethrowPg(error);
      }
    });
  }

  async issue(ctx: ClinicContext, id: string) {
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const locked = await client.query(
          `SELECT status, invoice_total::text FROM ${ctx.quotedSchema}.invoices WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const row = locked.rows[0] as { status: string; invoice_total: string } | undefined;
        if (!row) fail('INVOICE_NOT_FOUND', 'Invoice not found', 'missing');
        if (row.status !== 'DRAFT') fail('INVOICE_NOT_EDITABLE', 'Invoice is already issued', 'conflict');
        if (compareMoney(row.invoice_total, '0.00') <= 0) {
          fail('INVALID_AMOUNT', 'Invoice total must be greater than zero');
        }
        const settings = await this.readSettings(client, ctx);
        const seq = await client.query(
          `UPDATE ${ctx.quotedSchema}.billing_sequences
           SET invoice_seq = invoice_seq + 1 WHERE id = TRUE RETURNING invoice_seq`,
        );
        const number = `${settings.invoice_prefix}-${String(seq.rows[0].invoice_seq).padStart(6, '0')}`;
        await client.query(
          `UPDATE ${ctx.quotedSchema}.invoices SET
             status = 'ISSUED', invoice_number = $2, issued_at = NOW(), issued_by = $3,
             clinic_snapshot = $4::jsonb, updated_at = NOW(), version = version + 1
           WHERE id = $1`,
          [id, number, ctx.userId, JSON.stringify(settings)],
        );
        await this.auditBilling(client, ctx, 'billing.invoice_issued', 'invoice', id, { invoiceNumber: number });
        await client.query('COMMIT');
        return this.loadInvoice(client, ctx, id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async voidInvoice(ctx: ClinicContext, id: string, dto: VoidInvoiceDto) {
    if (ctx.role !== 'CLINIC_MANAGER') fail('BILLING_ACCESS_DENIED', 'Only a clinic manager can void an invoice', 'forbidden');
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const locked = await client.query(
          `SELECT status FROM ${ctx.quotedSchema}.invoices WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!locked.rows[0]) fail('INVOICE_NOT_FOUND', 'Invoice not found', 'missing');
        if (locked.rows[0].status !== 'ISSUED') fail('INVOICE_NOT_EDITABLE', 'Only an issued invoice can be voided', 'conflict');
        const activity = await client.query(
          `SELECT
             (SELECT COUNT(*) FROM ${ctx.quotedSchema}.payments WHERE invoice_id = $1) AS payments,
             (SELECT COUNT(*) FROM ${ctx.quotedSchema}.invoice_credit_notes WHERE invoice_id = $1) AS credits`,
          [id],
        );
        const counts = activity.rows[0] as { payments: string; credits: string };
        if (Number(counts.payments) > 0 || Number(counts.credits) > 0) {
          fail('INVOICE_NOT_EDITABLE', 'Invoices with payments or credit notes need a credit note and refund', 'conflict');
        }
        await client.query(
          `UPDATE ${ctx.quotedSchema}.invoices
           SET status = 'VOIDED', voided_at = NOW(), void_reason = $2, voided_by = $3, updated_at = NOW()
           WHERE id = $1`,
          [id, dto.reason.trim(), ctx.userId],
        );
        await this.auditBilling(client, ctx, 'billing.invoice_voided', 'invoice', id, { reason: dto.reason.trim() });
        await client.query('COMMIT');
        return this.loadInvoice(client, ctx, id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async recordPayment(ctx: ClinicContext, invoiceId: string, dto: RecordPaymentDto) {
    const amount = formatCents(parseMoneyToCents(dto.amount, 'amount'));
    if (compareMoney(amount, '0.00') <= 0) fail('INVALID_AMOUNT', 'Payment amount must be greater than zero');
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const locked = await client.query(
          `SELECT id, status, currency FROM ${ctx.quotedSchema}.invoices WHERE id = $1 FOR UPDATE`,
          [invoiceId],
        );
        if (!locked.rows[0]) fail('INVOICE_NOT_FOUND', 'Invoice not found', 'missing');
        if (locked.rows[0].status !== 'ISSUED') fail('INVOICE_NOT_PAYABLE', 'Only an issued invoice can be paid', 'conflict');
        const existing = await client.query(
          `SELECT id, amount::text FROM ${ctx.quotedSchema}.payments
           WHERE invoice_id = $1 AND idempotency_key = $2`,
          [invoiceId, dto.idempotencyKey],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].amount !== amount) {
            fail('IDEMPOTENCY_MISMATCH', 'This idempotency key was already used for a different amount', 'conflict');
          }
          await client.query('COMMIT');
          return this.loadInvoice(client, ctx, invoiceId);
        }
        const settings = await this.readSettings(client, ctx);
        if (!settings.allowed_methods.includes(dto.method)) {
          fail('PAYMENT_METHOD_NOT_ALLOWED', 'Payment method is not enabled for this clinic');
        }
        const money = await this.moneyFor(client, ctx, invoiceId);
        const view = settlement(money);
        if (compareMoney(view.balance, '0.00') <= 0) {
          fail('OVERPAYMENT', 'This invoice has no remaining balance');
        }
        if (compareMoney(amount, view.balance) > 0) {
          fail('OVERPAYMENT', 'Payment is greater than the remaining balance');
        }
        const sequences = await client.query(
          `UPDATE ${ctx.quotedSchema}.billing_sequences
           SET receipt_seq = receipt_seq + 1, payment_seq = payment_seq + 1
           WHERE id = TRUE
           RETURNING receipt_seq, payment_seq`,
        );
        const paymentId = randomUUID();
        const receiptNumber = `${settings.receipt_prefix}-${String(sequences.rows[0].receipt_seq).padStart(6, '0')}`;
        const paymentReference = `${settings.payment_prefix}-${String(sequences.rows[0].payment_seq).padStart(6, '0')}`;
        await client.query(
          `INSERT INTO ${ctx.quotedSchema}.payments
            (id, payment_reference, receipt_number, invoice_id, amount, method, external_reference, idempotency_key, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            paymentId,
            paymentReference,
            receiptNumber,
            invoiceId,
            amount,
            dto.method,
            dto.externalReference?.trim() || null,
            dto.idempotencyKey,
            ctx.userId,
          ],
        );
        await this.auditBilling(client, ctx, 'billing.payment_recorded', 'payment', paymentId, {
          invoiceId,
          amount,
          method: dto.method,
          receiptNumber,
        });
        await client.query('COMMIT');
        const invoice = await this.loadInvoice(client, ctx, invoiceId);
        return { ...invoice, paymentId, receiptNumber };
      } catch (error) {
        await client.query('ROLLBACK');
        this.rethrowPg(error);
      }
    });
  }

  async listPayments(ctx: ClinicContext, query: ListQueryDto) {
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    return this.sql.withClient(async (client) => {
      const rows = await client.query(
        `SELECT pay.id, pay.payment_reference, pay.receipt_number, pay.amount::text, pay.method,
                pay.recorded_at, pay.invoice_id, i.invoice_number, p.full_name AS patient_name, p.patient_number
         FROM ${ctx.quotedSchema}.payments pay
         JOIN ${ctx.quotedSchema}.invoices i ON i.id = pay.invoice_id
         JOIN ${ctx.quotedSchema}.patients p ON p.id = i.patient_id
         WHERE ($1::text IS NULL OR pay.method = $1)
           AND ($2::date IS NULL OR (pay.recorded_at AT TIME ZONE 'Asia/Colombo')::date >= $2::date)
           AND ($3::date IS NULL OR (pay.recorded_at AT TIME ZONE 'Asia/Colombo')::date <= $3::date)
           AND ($4::uuid IS NULL OR pay.recorded_by = $4::uuid)
         ORDER BY pay.recorded_at DESC
         LIMIT $5 OFFSET $6`,
        [query.method ?? null, query.from ?? null, query.to ?? null, query.cashierId ?? null, limit, offset],
      );
      return { items: rows.rows, limit, offset };
    });
  }

  async refund(ctx: ClinicContext, paymentId: string, dto: RefundDto) {
    if (ctx.role !== 'CLINIC_MANAGER') {
      fail('BILLING_ACCESS_DENIED', 'Only a clinic manager can record a refund', 'forbidden');
    }
    const amount = formatCents(parseMoneyToCents(dto.amount, 'amount'));
    if (compareMoney(amount, '0.00') <= 0) fail('INVALID_AMOUNT', 'Refund amount must be greater than zero');
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const payment = await client.query(
          `SELECT id, invoice_id, amount::text, method FROM ${ctx.quotedSchema}.payments WHERE id = $1 FOR UPDATE`,
          [paymentId],
        );
        const row = payment.rows[0] as { id: string; invoice_id: string; amount: string; method: string } | undefined;
        if (!row) fail('INVOICE_NOT_FOUND', 'Payment not found', 'missing');
        await client.query(`SELECT id FROM ${ctx.quotedSchema}.invoices WHERE id = $1 FOR UPDATE`, [row.invoice_id]);
        const prior = await client.query(
          `SELECT id, amount::text FROM ${ctx.quotedSchema}.payment_refunds
           WHERE payment_id = $1 AND idempotency_key = $2`,
          [paymentId, dto.idempotencyKey],
        );
        if (prior.rows[0]) {
          if (prior.rows[0].amount !== amount) {
            fail('IDEMPOTENCY_MISMATCH', 'This idempotency key was already used for a different refund', 'conflict');
          }
          await client.query('COMMIT');
          return this.loadInvoice(client, ctx, row.invoice_id);
        }
        const refunded = await client.query(
          `SELECT COALESCE(SUM(amount),0)::text AS amount FROM ${ctx.quotedSchema}.payment_refunds WHERE payment_id = $1`,
          [paymentId],
        );
        const refundable = subtractMoney(row.amount, refunded.rows[0].amount as string);
        if (compareMoney(amount, refundable) > 0) {
          fail('REFUND_EXCEEDS_BALANCE', 'Refund exceeds the remaining refundable amount', 'conflict');
        }
        const seq = await client.query(
          `UPDATE ${ctx.quotedSchema}.billing_sequences SET receipt_seq = receipt_seq + 1
           WHERE id = TRUE RETURNING receipt_seq`,
        );
        const settings = await this.readSettings(client, ctx);
        const refundId = randomUUID();
        const reference = `${settings.receipt_prefix}-RF-${String(seq.rows[0].receipt_seq).padStart(6, '0')}`;
        await client.query(
          `INSERT INTO ${ctx.quotedSchema}.payment_refunds
            (id, refund_reference, payment_id, amount, method, reason, idempotency_key, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [refundId, reference, paymentId, amount, dto.method, dto.reason.trim(), dto.idempotencyKey, ctx.userId],
        );
        await this.auditBilling(client, ctx, 'billing.refund_recorded', 'refund', refundId, {
          paymentId,
          amount,
          reason: dto.reason.trim(),
        });
        await client.query('COMMIT');
        return this.loadInvoice(client, ctx, row.invoice_id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async creditNote(ctx: ClinicContext, invoiceId: string, dto: CreditNoteDto) {
    if (ctx.role !== 'CLINIC_MANAGER') {
      fail('BILLING_ACCESS_DENIED', 'Only a clinic manager can issue a credit note', 'forbidden');
    }
    const amount = formatCents(parseMoneyToCents(dto.amount, 'amount'));
    if (compareMoney(amount, '0.00') <= 0) fail('INVALID_AMOUNT', 'Credit amount must be greater than zero');
    return this.sql.withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const locked = await client.query(
          `SELECT status, invoice_total::text FROM ${ctx.quotedSchema}.invoices WHERE id = $1 FOR UPDATE`,
          [invoiceId],
        );
        const invoice = locked.rows[0] as { status: string; invoice_total: string } | undefined;
        if (!invoice) fail('INVOICE_NOT_FOUND', 'Invoice not found', 'missing');
        if (invoice.status !== 'ISSUED') fail('INVOICE_NOT_EDITABLE', 'Credit notes apply to issued invoices', 'conflict');
        const existing = await client.query(
          `SELECT id, amount::text FROM ${ctx.quotedSchema}.invoice_credit_notes
           WHERE invoice_id = $1 AND idempotency_key = $2`,
          [invoiceId, dto.idempotencyKey],
        );
        if (existing.rows[0]) {
          if (existing.rows[0].amount !== amount) {
            fail('IDEMPOTENCY_MISMATCH', 'This idempotency key was already used for a different credit', 'conflict');
          }
          await client.query('COMMIT');
          return this.loadInvoice(client, ctx, invoiceId);
        }
        const credited = await client.query(
          `SELECT COALESCE(SUM(amount),0)::text AS amount FROM ${ctx.quotedSchema}.invoice_credit_notes WHERE invoice_id = $1`,
          [invoiceId],
        );
        const remaining = subtractMoney(invoice.invoice_total, credited.rows[0].amount as string);
        if (compareMoney(amount, remaining) > 0) {
          fail('CREDIT_EXCEEDS_INVOICE', 'Credit note exceeds the remaining invoice amount', 'conflict');
        }
        const settings = await this.readSettings(client, ctx);
        const seq = await client.query(
          `UPDATE ${ctx.quotedSchema}.billing_sequences SET credit_seq = credit_seq + 1
           WHERE id = TRUE RETURNING credit_seq`,
        );
        const creditId = randomUUID();
        const number = `${settings.credit_prefix}-${String(seq.rows[0].credit_seq).padStart(6, '0')}`;
        await client.query(
          `INSERT INTO ${ctx.quotedSchema}.invoice_credit_notes
            (id, credit_number, invoice_id, amount, reason, idempotency_key, issued_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [creditId, number, invoiceId, amount, dto.reason.trim(), dto.idempotencyKey, ctx.userId],
        );
        await this.auditBilling(client, ctx, 'billing.credit_note_issued', 'credit_note', creditId, {
          invoiceId,
          amount,
          number,
        });
        await client.query('COMMIT');
        return this.loadInvoice(client, ctx, invoiceId);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async report(ctx: ClinicContext, query: ListQueryDto) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
    const from = query.from ?? today;
    const to = query.to ?? from;
    return this.sql.withClient(async (client) => {
      const sums = await client.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE method = 'CASH'), 0)::text AS cash,
           COALESCE(SUM(amount) FILTER (WHERE method = 'CARD_EXTERNAL'), 0)::text AS card,
           COALESCE(SUM(amount) FILTER (WHERE method = 'BANK_TRANSFER'), 0)::text AS bank,
           COALESCE(SUM(amount), 0)::text AS collections,
           COUNT(*)::int AS payment_count
         FROM ${ctx.quotedSchema}.payments
         WHERE (recorded_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $1::date AND $2::date
           AND ($3::text IS NULL OR method = $3)
           AND ($4::uuid IS NULL OR recorded_by = $4::uuid)`,
        [from, to, query.method ?? null, query.cashierId ?? null],
      );
      const refunds = await client.query(
        `SELECT COALESCE(SUM(amount),0)::text AS amount, COUNT(*)::int AS count
         FROM ${ctx.quotedSchema}.payment_refunds
         WHERE (recorded_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $1::date AND $2::date`,
        [from, to],
      );
      const issued = await client.query(
        `SELECT COALESCE(SUM(invoice_total),0)::text AS amount, COUNT(*)::int AS count
         FROM ${ctx.quotedSchema}.invoices
         WHERE status = 'ISSUED'
           AND (issued_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $1::date AND $2::date`,
        [from, to],
      );
      const credits = await client.query(
        `SELECT COALESCE(SUM(amount),0)::text AS amount
         FROM ${ctx.quotedSchema}.invoice_credit_notes
         WHERE (issued_at AT TIME ZONE 'Asia/Colombo')::date BETWEEN $1::date AND $2::date`,
        [from, to],
      );
      const outstanding = await client.query(
        `SELECT COALESCE(SUM(bal),0)::text AS amount FROM (
           SELECT (
             i.invoice_total
             - COALESCE((SELECT SUM(amount) FROM ${ctx.quotedSchema}.invoice_credit_notes c WHERE c.invoice_id = i.id), 0)
             - (
               COALESCE((SELECT SUM(amount) FROM ${ctx.quotedSchema}.payments p WHERE p.invoice_id = i.id), 0)
               - COALESCE((SELECT SUM(r.amount) FROM ${ctx.quotedSchema}.payment_refunds r
                            JOIN ${ctx.quotedSchema}.payments p ON p.id = r.payment_id
                            WHERE p.invoice_id = i.id), 0)
             )
           ) AS bal
           FROM ${ctx.quotedSchema}.invoices i
           WHERE i.status = 'ISSUED'
         ) s WHERE bal > 0`,
      );
      const row = sums.rows[0] as { cash: string; card: string; bank: string; collections: string; payment_count: number };
      const money = (value: string) => formatCents(parseMoneyToCents(value));
      const net = subtractMoney(money(row.collections), money(refunds.rows[0].amount as string));
      return {
        timezone: 'Asia/Colombo',
        from,
        to,
        invoiced: money(issued.rows[0].amount as string),
        invoicesIssued: issued.rows[0].count,
        cash: money(row.cash),
        cardExternal: money(row.card),
        bankTransfer: money(row.bank),
        collections: money(row.collections),
        paymentsRecorded: row.payment_count,
        refunds: money(refunds.rows[0].amount as string),
        credits: money(credits.rows[0].amount as string),
        netCollections: net,
        outstanding: money(outstanding.rows[0].amount as string),
        note: 'Net collections are confirmed receipts minus executed refunds. This is not a profit statement. Invoiced amounts are not cash collected.',
      };
    });
  }

  /** Invoice / appointment / doctor / patient reports. Rows are exported to CSV, Excel or PDF by the web app. */
  async categoryReport(ctx: ClinicContext, category: ReportCategory, query: ListQueryDto) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Colombo' }).format(new Date());
    const from = query.from ?? today;
    const to = query.to ?? from;
    if (from > to) {
      throw new BadRequestException('The From date must be on or before the To date');
    }
    return this.sql.withClient(async (client) => {
      const report = await buildCategoryReport(client, ctx.quotedSchema, category, from, to);
      await this.auditBilling(client, ctx, 'billing.report_generated', 'report', null, {
        category,
        from,
        to,
        rows: report.rows.length,
      });
      return report;
    });
  }

  async exportCsv(ctx: ClinicContext, query: ListQueryDto) {
    const report = await this.report(ctx, query);
    await this.sql.withClient(async (client) => {
      await this.auditBilling(client, ctx, 'billing.report_exported', 'report', null, {
        from: report.from,
        to: report.to,
      });
    });
    const lines = [
      ['metric', 'amount_lkr'].map(csvCell).join(','),
      ['invoiced', report.invoiced],
      ['cash_collected', report.cash],
      ['card_external', report.cardExternal],
      ['bank_transfer', report.bankTransfer],
      ['collections', report.collections],
      ['refunds', report.refunds],
      ['credits', report.credits],
      ['net_collections', report.netCollections],
      ['outstanding', report.outstanding],
    ].map((row) => (Array.isArray(row) ? row.map((cell) => csvCell(String(cell))).join(',') : row));
    return { filename: `hellodoc-collections-${report.from}-to-${report.to}.csv`, body: `${lines.join('\n')}\n` };
  }

  async invoiceHtml(ctx: ClinicContext, id: string) {
    const invoice = await this.getInvoice(ctx, id);
    if (invoice.status === 'DRAFT') {
      return this.documentHtml({
        title: 'DRAFT INVOICE',
        watermark: 'DRAFT',
        clinic: invoice.clinic,
        lines: [
          `Patient: ${invoice.patientName} (${invoice.patientNumber})`,
          `Status: DRAFT — not issued`,
          `Total: LKR ${invoice.invoiceTotal}`,
        ],
        items: invoice.items,
      });
    }
    const taxInvoice = invoice.clinic.documentMode === 'VAT_TAX_INVOICE';
    return this.documentHtml({
      title: taxInvoice ? 'TAX INVOICE' : 'INVOICE',
      watermark: '',
      clinic: invoice.clinic,
      lines: [
        `Invoice: ${invoice.invoiceNumber}`,
        `Patient: ${invoice.patientName} (${invoice.patientNumber})`,
        `Issued: ${invoice.issuedAt ?? ''}`,
        `Total: LKR ${invoice.invoiceTotal}`,
        `Paid: LKR ${invoice.paid}`,
        `Balance: LKR ${invoice.balance}`,
        taxInvoice ? 'Document type: VAT tax invoice (accountant-confirmed clinic setting).' : 'Document type: ordinary invoice. Not a VAT tax invoice.',
      ],
      items: invoice.items,
    });
  }

  async receiptHtml(ctx: ClinicContext, paymentId: string) {
    const payment = await this.sql.withClient(async (client) => {
      const row = await client.query(
        `SELECT pay.receipt_number, pay.payment_reference, pay.amount::text, pay.method, pay.recorded_at,
                pay.external_reference, i.id AS invoice_id, i.invoice_number, i.clinic_snapshot,
                p.full_name, p.patient_number
         FROM ${ctx.quotedSchema}.payments pay
         JOIN ${ctx.quotedSchema}.invoices i ON i.id = pay.invoice_id
         JOIN ${ctx.quotedSchema}.patients p ON p.id = i.patient_id
         WHERE pay.id = $1`,
        [paymentId],
      );
      return row.rows[0] as Record<string, unknown> | undefined;
    });
    if (!payment) fail('INVOICE_NOT_FOUND', 'Receipt not found', 'missing');
    const invoice = await this.getInvoice(ctx, String(payment.invoice_id));
    const snap = (payment.clinic_snapshot ?? {}) as Record<string, unknown>;
    return this.documentHtml({
      title: 'PAYMENT RECEIPT',
      watermark: '',
      clinic: {
        displayName: String(snap.display_name ?? invoice.clinic.displayName ?? ''),
        address: String(snap.address ?? ''),
        contact: String(snap.contact ?? ''),
        receiptFooter: String(snap.receipt_footer ?? ''),
        documentMode: 'ORDINARY_RECEIPT',
        taxRegistered: false,
        taxRegistrationNo: null,
      },
      lines: [
        `Receipt: ${payment.receipt_number}`,
        `Payment: ${payment.payment_reference}`,
        `Invoice: ${payment.invoice_number ?? ''}`,
        `Patient: ${payment.full_name} (${payment.patient_number})`,
        `Method: ${payment.method}`,
        payment.external_reference ? `External reference: ${payment.external_reference}` : '',
        `Amount received: LKR ${payment.amount}`,
        `Remaining balance: LKR ${invoice.balance}`,
        `Recorded: ${payment.recorded_at}`,
        'This receipt records a payment. It is not a VAT tax invoice and does not include clinical notes.',
      ].filter(Boolean) as string[],
      items: invoice.items.map((item) => ({ description: item.description, lineTotal: item.lineTotal })),
    });
  }

  private documentHtml(input: {
    title: string;
    watermark: string;
    clinic: {
      displayName: string;
      address: string;
      contact: string;
      receiptFooter?: string;
      documentMode?: string;
      taxRegistered?: boolean;
      taxRegistrationNo?: string | null;
    };
    lines: string[];
    items: Array<{ description: string; lineTotal: string }>;
  }) {
    const rows = input.items
      .map(
        (item) =>
          `<tr><td>${escapeHtml(item.description)}</td><td style="text-align:right">LKR ${escapeHtml(item.lineTotal)}</td></tr>`,
      )
      .join('');
    const watermark = input.watermark
      ? `<div style="position:fixed;inset:30%;font-size:80px;color:rgba(180,0,0,.18);transform:rotate(-20deg);font-weight:700">${escapeHtml(input.watermark)}</div>`
      : '';
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(input.title)}</title>
      <style>body{font-family:Arial,sans-serif;margin:32px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}td,th{border-bottom:1px solid #ccc;padding:6px;text-align:left}</style>
      </head><body>${watermark}
      <p style="letter-spacing:.2em;color:#0f766e;font-size:12px">HELLODOC</p>
      <h1 style="margin:0">${escapeHtml(input.clinic.displayName || 'Clinic')}</h1>
      <p>${escapeHtml(input.clinic.address)}<br>${escapeHtml(input.clinic.contact)}</p>
      <h2>${escapeHtml(input.title)}</h2>
      ${input.lines.map((line) => `<p style="margin:4px 0">${escapeHtml(line)}</p>`).join('')}
      <table><thead><tr><th>Service</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
      <p>${escapeHtml(input.clinic.receiptFooter ?? '')}</p>
      </body></html>`;
  }

  private async loadInvoice(client: PoolClient, ctx: ClinicContext, id: string) {
    const invoice = await client.query(
      `SELECT i.*, i.subtotal::text, i.discount_total::text, i.tax_total::text, i.invoice_total::text,
              p.full_name, p.patient_number,
              COALESCE((SELECT SUM(amount) FROM ${ctx.quotedSchema}.payments pay WHERE pay.invoice_id = i.id),0)::text AS paid,
              COALESCE((SELECT SUM(r.amount) FROM ${ctx.quotedSchema}.payment_refunds r
                         JOIN ${ctx.quotedSchema}.payments pay ON pay.id = r.payment_id
                         WHERE pay.invoice_id = i.id),0)::text AS refunded,
              COALESCE((SELECT SUM(amount) FROM ${ctx.quotedSchema}.invoice_credit_notes c WHERE c.invoice_id = i.id),0)::text AS credits
       FROM ${ctx.quotedSchema}.invoices i
       JOIN ${ctx.quotedSchema}.patients p ON p.id = i.patient_id
       WHERE i.id = $1`,
      [id],
    );
    const row = invoice.rows[0] as Record<string, string> | undefined;
    if (!row) fail('INVOICE_NOT_FOUND', 'Invoice not found', 'missing');
    const items = await client.query(
      `SELECT service_id, description, quantity, unit_price::text, discount::text, tax_amount::text, line_total::text, tax_classification
       FROM ${ctx.quotedSchema}.invoice_items WHERE invoice_id = $1 ORDER BY position`,
      [id],
    );
    const payments = await client.query(
      `SELECT id, payment_reference, receipt_number, amount::text, method, recorded_at, external_reference
       FROM ${ctx.quotedSchema}.payments WHERE invoice_id = $1 ORDER BY recorded_at`,
      [id],
    );
    const credits = await client.query(
      `SELECT id, credit_number, amount::text, reason, issued_at FROM ${ctx.quotedSchema}.invoice_credit_notes
       WHERE invoice_id = $1 ORDER BY issued_at`,
      [id],
    );
    const money = settlement({
      paid: row.paid,
      refunded: row.refunded,
      credits: row.credits,
      invoice_total: row.invoice_total,
      status: row.status,
    });
    const snap = (row.clinic_snapshot ?? {}) as unknown as Record<string, unknown>;
    const settings = Object.keys(snap).length ? snap : await this.readSettings(client, ctx);
    return {
      id: row.id,
      invoiceNumber: row.invoice_number,
      appointmentId: row.appointment_id,
      patientId: row.patient_id,
      patientName: row.full_name,
      patientNumber: row.patient_number,
      status: row.status,
      currency: 'LKR',
      subtotal: row.subtotal,
      discountTotal: row.discount_total,
      taxTotal: row.tax_total,
      invoiceTotal: row.invoice_total,
      paid: money.netPaid,
      balance: money.balance,
      excessToReconcile: money.excessToReconcile,
      settlement: money.settlement,
      version: Number(row.version),
      issuedAt: row.issued_at,
      voidReason: row.void_reason,
      items: items.rows.map((item) => ({
        serviceId: item.service_id as string | null,
        description: item.description as string,
        quantity: item.quantity as number,
        unitPrice: item.unit_price as string,
        discount: item.discount as string,
        tax: item.tax_amount as string,
        lineTotal: item.line_total as string,
        taxClassification: item.tax_classification as string,
      })),
      payments: payments.rows,
      creditNotes: credits.rows,
      clinic: this.clinicView(settings as Record<string, unknown>),
    };
  }

  private clinicView(settings: Record<string, unknown>) {
    return {
      displayName: String(settings.display_name ?? settings.displayName ?? ''),
      address: String(settings.address ?? ''),
      contact: String(settings.contact ?? ''),
      receiptFooter: String(settings.receipt_footer ?? settings.receiptFooter ?? ''),
      documentMode: String(settings.document_mode ?? settings.documentMode ?? 'ORDINARY_RECEIPT'),
      taxRegistered: Boolean(settings.tax_registered ?? settings.taxRegistered ?? false),
      taxRegistrationNo: (settings.tax_registration_no ?? settings.taxRegistrationNo ?? null) as string | null,
    };
  }

  private async replaceItems(
    client: PoolClient,
    ctx: ClinicContext,
    invoiceId: string,
    items: CreateInvoiceDto['items'],
    expectedVersion: number,
  ) {
    const settings = await this.readSettings(client, ctx);
    if (ctx.role === 'CLINIC_CASHIER' && !settings.cashier_may_discount) {
      if (items.some((item) => item.discount && compareMoney(item.discount, '0.00') > 0)) {
        fail('BILLING_ACCESS_DENIED', 'Cashiers cannot apply discounts', 'forbidden');
      }
    }
    await client.query(`DELETE FROM ${ctx.quotedSchema}.invoice_items WHERE invoice_id = $1`, [invoiceId]);
    const grosses: string[] = [];
    const discounts: string[] = [];
    const taxes: string[] = [];
    const totals: string[] = [];
    for (const [index, item] of items.entries()) {
      const service = await client.query(
        `SELECT id, name, price::text, tax_classification, active
         FROM ${ctx.quotedSchema}.billing_services WHERE id = $1`,
        [item.serviceId],
      );
      const svc = service.rows[0] as
        | { id: string; name: string; price: string; tax_classification: string; active: boolean }
        | undefined;
      if (!svc || !svc.active) fail('INVOICE_NOT_FOUND', 'Service is not available', 'missing');
      const applyTax =
        settings.tax_registered &&
        svc.tax_classification === 'TAXABLE' &&
        settings.vat_rate != null;
      const qty = Math.max(1, item.quantity ?? 1);
      const unitPrice =
        item.unitPrice && compareMoney(item.unitPrice, '0.00') >= 0
          ? formatCents(parseMoneyToCents(item.unitPrice, 'unitPrice'))
          : svc.price;
      let amounts;
      try {
        amounts = lineAmounts({
          quantity: qty,
          unitPrice,
          discount: item.discount ?? '0',
          taxRatePercent: applyTax ? String(settings.vat_rate) : null,
        });
      } catch (error) {
        fail('INVALID_AMOUNT', error instanceof Error ? error.message : 'Invalid amount');
      }
      grosses.push(amounts.gross);
      discounts.push(amounts.discount);
      taxes.push(amounts.tax);
      totals.push(amounts.total);
      await client.query(
        `INSERT INTO ${ctx.quotedSchema}.invoice_items
          (id, invoice_id, service_id, description, quantity, unit_price, discount, tax_classification, tax_rate, tax_amount, line_total, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          randomUUID(),
          invoiceId,
          svc.id,
          item.description?.trim() || svc.name,
          qty,
          unitPrice,
          amounts.discount,
          svc.tax_classification,
          applyTax ? settings.vat_rate : null,
          amounts.tax,
          amounts.total,
          index + 1,
        ],
      );
    }
    const updated = await client.query(
      `UPDATE ${ctx.quotedSchema}.invoices SET
         subtotal = $2, discount_total = $3, tax_total = $4, invoice_total = $5,
         version = version + 1, updated_at = NOW()
       WHERE id = $1 AND version = $6
       RETURNING id`,
      [invoiceId, sumCents(grosses), sumCents(discounts), sumCents(taxes), sumCents(totals), expectedVersion],
    );
    if (!updated.rows[0]) fail('VERSION_CONFLICT', 'Invoice was updated elsewhere', 'conflict');
  }

  private async assertPatientAppointment(
    client: PoolClient,
    ctx: ClinicContext,
    patientId: string,
    appointmentId?: string,
  ) {
    const patient = await client.query(
      `SELECT id FROM ${ctx.quotedSchema}.patients WHERE id = $1 AND status = 'ACTIVE'`,
      [patientId],
    );
    if (!patient.rows[0]) fail('INVOICE_NOT_FOUND', 'Patient not found', 'missing');
    if (!appointmentId) return;
    const appointment = await client.query(
      `SELECT id FROM ${ctx.quotedSchema}.appointments
       WHERE id = $1 AND patient_id = $2 AND status = 'CONFIRMED'`,
      [appointmentId, patientId],
    );
    if (!appointment.rows[0]) fail('INVOICE_NOT_FOUND', 'Appointment is not linked to this patient', 'missing');
  }

  private async moneyFor(client: PoolClient, ctx: ClinicContext, invoiceId: string): Promise<MoneyRow> {
    const row = await client.query(
      `SELECT i.status, i.invoice_total::text,
              COALESCE((SELECT SUM(amount) FROM ${ctx.quotedSchema}.payments WHERE invoice_id = i.id),0)::text AS paid,
              COALESCE((SELECT SUM(r.amount) FROM ${ctx.quotedSchema}.payment_refunds r
                         JOIN ${ctx.quotedSchema}.payments p ON p.id = r.payment_id
                         WHERE p.invoice_id = i.id),0)::text AS refunded,
              COALESCE((SELECT SUM(amount) FROM ${ctx.quotedSchema}.invoice_credit_notes c WHERE c.invoice_id = i.id),0)::text AS credits
       FROM ${ctx.quotedSchema}.invoices i WHERE i.id = $1`,
      [invoiceId],
    );
    return row.rows[0] as MoneyRow;
  }

  private async readSettings(client: PoolClient, ctx: ClinicContext) {
    const row = await client.query(`SELECT * FROM ${ctx.quotedSchema}.billing_settings WHERE id = TRUE`);
    const settings = row.rows[0] as Record<string, unknown>;
    return {
      display_name: String(settings.display_name ?? ''),
      address: String(settings.address ?? ''),
      contact: String(settings.contact ?? ''),
      invoice_prefix: String(settings.invoice_prefix ?? 'INV'),
      receipt_prefix: String(settings.receipt_prefix ?? 'RCT'),
      payment_prefix: String(settings.payment_prefix ?? 'PAY'),
      credit_prefix: String(settings.credit_prefix ?? 'CN'),
      allowed_methods: (settings.allowed_methods as string[]) ?? ['CASH'],
      cashier_may_discount: Boolean(settings.cashier_may_discount),
      receipt_footer: String(settings.receipt_footer ?? ''),
      tax_registered: Boolean(settings.tax_registered),
      tax_registration_no: (settings.tax_registration_no as string | null) ?? null,
      vat_rate: settings.vat_rate == null ? null : String(settings.vat_rate),
      document_mode: String(settings.document_mode ?? 'ORDINARY_RECEIPT'),
    };
  }

  private mapSettings(row: Record<string, unknown>) {
    return {
      displayName: row.display_name,
      address: row.address,
      contact: row.contact,
      currency: 'LKR',
      invoicePrefix: row.invoice_prefix,
      receiptPrefix: row.receipt_prefix,
      creditPrefix: row.credit_prefix,
      defaultServiceId: row.default_service_id,
      allowedMethods: row.allowed_methods,
      cashierMayDiscount: row.cashier_may_discount,
      receiptFooter: row.receipt_footer,
      taxRegistered: row.tax_registered,
      taxRegistrationNo: row.tax_registration_no,
      vatRate: row.vat_rate == null ? null : String(row.vat_rate),
      documentMode: row.document_mode,
      taxReviewRequired: true,
      accountantNote:
        'Do not enable VAT tax invoices unless a qualified accountant confirms this clinic is VAT-registered and the supply is taxable. Ordinary receipts stay unlabeled as tax invoices.',
    };
  }

  private async auditBilling(
    client: PoolClient,
    ctx: ClinicContext,
    action: string,
    entityType: string,
    entityId: string | null,
    details: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO ${ctx.quotedSchema}.billing_audit_events (id, actor_id, action, entity_type, entity_id, details)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
      [randomUUID(), ctx.userId, action, entityType, entityId, JSON.stringify(details)],
    );
  }

  private rethrowPg(error: unknown): never {
    const code = (error as { code?: string }).code;
    if (code === '23505') {
      const constraint = String((error as { constraint?: string }).constraint ?? '');
      if (constraint.includes('appointment')) {
        fail('INVOICE_DUPLICATE', 'This appointment already has an open invoice', 'conflict');
      }
      fail('INVOICE_DUPLICATE', 'A unique billing reference already exists', 'conflict');
    }
    throw error;
  }
}
