import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentSession, Public, Roles } from '../auth/decorators.js';
import type { AuthenticatedSession } from '../auth/session.service.js';
import { ClinicContextService } from '../clinic-context/clinic-context.service.js';
import { BillingService } from './billing.service.js';
import {
  MANAGER_ONLY_CATEGORIES,
  REPORT_CATEGORIES,
  type ReportCategory,
} from './category-reports.js';
import {
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

@Controller()
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly clinicContext: ClinicContextService,
  ) {}

  @Roles('clinic_manager')
  @Post('clinic/staff/cashier-invitations')
  invite(@CurrentSession() session: AuthenticatedSession, @Body() dto: InviteCashierDto) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.inviteCashier(ctx, dto));
  }

  @Roles('clinic_manager')
  @Post('clinic/staff/receptionist-invitations')
  inviteReceptionist(@CurrentSession() session: AuthenticatedSession, @Body() dto: InviteCashierDto) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.inviteReceptionist(ctx, dto));
  }
  @Public()
  @Post('staff/invitations/accept')
  accept(@Body() dto: AcceptStaffInviteDto) {
    return this.billing.acceptCashier(dto);
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/billing/settings')
  @Header('Cache-Control', 'no-store')
  settings(@CurrentSession() session: AuthenticatedSession) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.getSettings(ctx));
  }

  @Roles('clinic_manager')
  @Patch('clinic/billing/settings')
  patchSettings(@CurrentSession() session: AuthenticatedSession, @Body() dto: BillingSettingsDto) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.updateSettings(ctx, dto));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/billing/services')
  services(@CurrentSession() session: AuthenticatedSession) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.listServices(ctx));
  }

  @Roles('clinic_manager')
  @Post('clinic/billing/services')
  createService(@CurrentSession() session: AuthenticatedSession, @Body() dto: CreateServiceDto) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.createService(ctx, dto));
  }

  @Roles('clinic_manager')
  @Patch('clinic/billing/services/:id')
  updateService(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.updateService(ctx, id, dto));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/billing/services/:id')
  getService(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.getService(ctx, id));
  }

  @Roles('clinic_manager')
  @Delete('clinic/billing/services/:id')
  deleteService(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.deleteService(ctx, id));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/invoices')
  @Header('Cache-Control', 'no-store')
  list(@CurrentSession() session: AuthenticatedSession, @Query() query: ListQueryDto) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.listInvoices(ctx, query));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/billing/billable-appointments')
  @Header('Cache-Control', 'no-store')
  billableAppointments(@CurrentSession() session: AuthenticatedSession) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.listBillableAppointments(ctx));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Post('clinic/invoices')
  create(@CurrentSession() session: AuthenticatedSession, @Body() dto: CreateInvoiceDto) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.createInvoice(ctx, dto));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/invoices/:id')
  @Header('Cache-Control', 'no-store')
  get(@CurrentSession() session: AuthenticatedSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.getInvoice(ctx, id));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Patch('clinic/invoices/:id/draft')
  draft(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SaveInvoiceDraftDto,
  ) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.saveDraft(ctx, id, dto));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Post('clinic/invoices/:id/issue')
  issue(@CurrentSession() session: AuthenticatedSession, @Param('id', ParseUUIDPipe) id: string) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.issue(ctx, id));
  }

  @Roles('clinic_manager')
  @Post('clinic/invoices/:id/void')
  voidInvoice(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VoidInvoiceDto,
  ) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.voidInvoice(ctx, id, dto));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/invoices/:id/print')
  async printInvoice(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const ctx = await this.clinicContext.resolveFinance(session);
    const html = await this.billing.invoiceHtml(ctx, id);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Post('clinic/invoices/:id/payments')
  pay(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.recordPayment(ctx, id, dto));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/payments')
  @Header('Cache-Control', 'no-store')
  payments(@CurrentSession() session: AuthenticatedSession, @Query() query: ListQueryDto) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.listPayments(ctx, query));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/payments/:id/receipt')
  async receipt(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const ctx = await this.clinicContext.resolveFinance(session);
    const html = await this.billing.receiptHtml(ctx, id);
    res.setHeader('Cache-Control', 'no-store');
    res.type('html').send(html);
  }

  @Roles('clinic_manager')
  @Post('clinic/payments/:id/refunds')
  refund(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundDto,
  ) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.refund(ctx, id, dto));
  }

  @Roles('clinic_manager')
  @Post('clinic/invoices/:id/credit-notes')
  credit(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreditNoteDto,
  ) {
    return this.clinicContext.resolve(session).then((ctx) => this.billing.creditNote(ctx, id, dto));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/billing/reports/daily')
  @Header('Cache-Control', 'no-store')
  daily(@CurrentSession() session: AuthenticatedSession, @Query() query: ListQueryDto) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.report(ctx, query));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/billing/reports/collections')
  collections(@CurrentSession() session: AuthenticatedSession, @Query() query: ListQueryDto) {
    return this.clinicContext.resolveFinance(session).then((ctx) => this.billing.report(ctx, query));
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/billing/reports/category/:category')
  @Header('Cache-Control', 'no-store')
  async categoryReport(
    @CurrentSession() session: AuthenticatedSession,
    @Param('category') category: string,
    @Query() query: ListQueryDto,
  ) {
    if (!(REPORT_CATEGORIES as readonly string[]).includes(category)) {
      throw new NotFoundException('Unknown report category');
    }
    const typed = category as ReportCategory;
    // Appointment, doctor and patient reports carry patient visit data: managers only.
    const ctx = MANAGER_ONLY_CATEGORIES.includes(typed)
      ? await this.clinicContext.resolve(session)
      : await this.clinicContext.resolveFinance(session);
    return this.billing.categoryReport(ctx, typed, query);
  }

  @Roles('clinic_manager', 'clinic_cashier')
  @Get('clinic/billing/reports/export')
  async exportCsv(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: ListQueryDto,
    @Res() res: Response,
  ) {
    const ctx = await this.clinicContext.resolveFinance(session);
    const file = await this.billing.exportCsv(ctx, query);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.type('text/csv').send(file.body);
  }
}
