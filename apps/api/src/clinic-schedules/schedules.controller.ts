import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentSession, Roles } from '../auth/decorators.js';
import type { AuthenticatedSession } from '../auth/session.service.js';
import { ClinicContextService } from '../clinic-context/clinic-context.service.js';
import {
  BulkUpdateTemplateSessionsDto,
  CreateScheduleTemplatesDto,
  DeactivateScheduleTemplateDto,
  MaterializeScheduleDto,
} from './dto/schedule.dto.js';
import { SchedulesService } from './schedules.service.js';

@Controller('clinic')
export class SchedulesController {
  constructor(
    private readonly schedules: SchedulesService,
    private readonly clinicContext: ClinicContextService,
  ) {}

  @Roles('clinic_manager')
  @Get('doctors/:id/schedule-templates')
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const ctx = await this.clinicContext.resolve(session);
    return this.schedules.listForDoctor(ctx, id);
  }

  @Roles('clinic_manager')
  @Post('doctors/:id/schedule-templates')
  async create(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateScheduleTemplatesDto,
  ) {
    const ctx = await this.clinicContext.resolve(session);
    return this.schedules.createForDoctor(ctx, id, dto);
  }

  @Roles('clinic_manager')
  @Post('schedule-templates/:id/deactivate')
  async deactivate(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeactivateScheduleTemplateDto,
  ) {
    const ctx = await this.clinicContext.resolve(session);
    return this.schedules.deactivate(ctx, id, dto);
  }

  @Roles('clinic_manager')
  @Post('schedule-templates/:id/activate')
  async activate(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const ctx = await this.clinicContext.resolve(session);
    return this.schedules.activate(ctx, id);
  }

  @Roles('clinic_manager')
  @Post('schedule-templates/:id/bulk-update')
  async bulkUpdateSessions(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: BulkUpdateTemplateSessionsDto,
  ) {
    const ctx = await this.clinicContext.resolve(session);
    return this.schedules.bulkUpdateSessions(ctx, id, dto);
  }

  @Roles('clinic_manager')
  @Post('schedule-templates/:id/materialize')
  async materialize(
    @CurrentSession() session: AuthenticatedSession,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MaterializeScheduleDto,
  ) {
    const ctx = await this.clinicContext.resolve(session);
    return this.schedules.materialize(ctx, id, dto);
  }
}
