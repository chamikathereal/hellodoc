import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentSession, Roles } from '../auth/decorators.js';
import type { AuthenticatedSession } from '../auth/session.service.js';
import { ClinicContextService } from '../clinic-context/clinic-context.service.js';
import { ListSessionsQueryDto } from './dto/session.dto.js';
import { SessionsService } from './sessions.service.js';

/** Read-only session list for the signed-in doctor (their own sessions only), used by the doctor calendar. */
@Controller('doctor/sessions')
export class DoctorSessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly clinicContext: ClinicContextService,
  ) {}

  @Roles('clinic_doctor')
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentSession() session: AuthenticatedSession,
    @Query() query: ListSessionsQueryDto,
  ) {
    const ctx = await this.clinicContext.resolveDoctor(session);
    return this.sessions.list(ctx, { ...query, doctorId: ctx.doctorId });
  }
}
