import { Module } from '@nestjs/common';
import { ClinicNotificationsModule } from '../clinic-notifications/clinic-notifications.module.js';
import { ClinicQueueModule } from '../clinic-queue/clinic-queue.module.js';
import { TenantProvisioningModule } from '../tenant-provisioning/tenant-provisioning.module.js';
import { DoctorSessionsController } from './doctor-sessions.controller.js';
import { SessionsController } from './sessions.controller.js';
import { SessionsService } from './sessions.service.js';

@Module({
  imports: [TenantProvisioningModule, ClinicQueueModule, ClinicNotificationsModule],
  controllers: [SessionsController, DoctorSessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class ClinicSessionsModule {}
