import { Module } from '@nestjs/common';
import { TenantProvisioningModule } from '../tenant-provisioning/tenant-provisioning.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [TenantProvisioningModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class ClinicBillingModule {}
